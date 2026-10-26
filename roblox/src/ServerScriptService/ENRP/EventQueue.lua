--!strict
-- Puffert Spielereignisse und sendet sie gebündelt. Jedes Ereignis hat eine feste ID (GUID):
-- Das Backend verarbeitet jede ID genau einmal, Wiederholungen nach Fehlern sind daher sicher.
local Api = require(script.Parent.Api)
local Config = require(script.Parent.Config)

local EventQueue = {}
local queue: { any } = {}
local flushing = false
local rejectedInARow = 0

local function isoNow(): string
	return DateTime.now():ToIsoDate()
end

function EventQueue.push(eventType: string, data: { [string]: any })
	if #queue >= Config.MaxQueuedEvents then
		-- Älteste Ereignisse verwerfen, damit der Server nicht unbegrenzt Speicher belegt.
		table.remove(queue, 1)
		warn("[ENRP] Ereigniswarteschlange voll – ältestes Ereignis verworfen")
	end
	table.insert(queue, { id = Api.newId(), type = eventType, occurredAt = isoNow(), data = data })
end

-- Sendet ausstehende Ereignisse. Bei Fehlern bleiben sie (mit denselben IDs) in der Warteschlange.
function EventQueue.flush(): boolean
	if flushing or #queue == 0 then
		return true
	end
	flushing = true
	local batch = {}
	for i = 1, math.min(#queue, Config.MaxEventsPerBatch) do
		batch[i] = queue[i]
	end
	local response = Api.request("POST", "/api/v1/game/events", { jobId = game.JobId, events = batch })
	if response.ok then
		rejectedInARow = 0
		for _ = 1, #batch do
			table.remove(queue, 1)
		end
		local results = response.body and response.body.results or {}
		for _, result in results do
			if result.status == "rejected" then
				warn(("[ENRP] Ereignis %s abgelehnt: %s"):format(result.id, tostring(result.result and result.result.reason or result.error)))
			end
		end
	elseif response.status == 400 then
		-- Ungültige Charge (z. B. Server noch nicht per Heartbeat bekannt): später erneut versuchen,
		-- aber dauerhaft ungültige Ereignisse nicht endlos senden.
		rejectedInARow += 1
		warn("[ENRP] Ereignisse abgelehnt: " .. tostring(response.message))
		if rejectedInARow >= 3 then
			for _ = 1, #batch do
				table.remove(queue, 1)
			end
			rejectedInARow = 0
			warn("[ENRP] Dauerhaft ungültige Ereignisse verworfen")
		end
	else
		warn("[ENRP] Ereignisse konnten nicht gesendet werden: " .. tostring(response.errorCode))
	end
	flushing = false
	return response.ok
end

function EventQueue.size(): number
	return #queue
end

return EventQueue
