--!strict
-- Gepufferte Übertragung von Spielereignissen. Jedes Ereignis erhält beim Entstehen eine GUID,
-- dadurch sind Wiederholungen nach Fehlern idempotent (das Backend verwirft Duplikate).
local HttpService = game:GetService("HttpService")

local Api = require(script.Parent.Api)
local Config = require(script.Parent.Config)

local EventQueue = {}
local queue: { any } = {}
local flushing = false

function EventQueue.push(eventType: string, fields: { [string]: any })
	local event = table.clone(fields)
	event.type = eventType
	event.eventId = HttpService:GenerateGUID(false)
	event.occurredAt = Api.nowIso()
	if #queue >= Config.MaxQueuedEvents then
		-- Älteste Ereignisse verwerfen, statt den Speicher unbegrenzt zu füllen (API länger nicht erreichbar).
		table.remove(queue, 1)
		warn("[EmdenNetwork] Ereignis-Warteschlange voll, ältestes Ereignis verworfen")
	end
	table.insert(queue, event)
end

-- Sendet bis zu 50 Ereignisse. Bei technischem Fehler bleiben sie in der Warteschlange.
function EventQueue.flush()
	if flushing or #queue == 0 then
		return
	end
	flushing = true
	local batch = {}
	for i = 1, math.min(50, #queue) do
		batch[i] = queue[i]
	end
	local res = Api.request("POST", "/v1/game/events", { jobId = Api.JobId, events = batch })
	if res.ok or (res.status >= 400 and res.status < 500 and res.status ~= 409 and res.status ~= 429) then
		-- Erfolgreich oder fachlich abgelehnt (z. B. Validierung): nicht erneut senden.
		for _ = 1, #batch do
			table.remove(queue, 1)
		end
		if res.ok and res.body and res.body.results then
			for _, r in res.body.results do
				if r.status == "rejected" then
					warn(`[EmdenNetwork] Ereignis abgelehnt: {r.eventId} ({r.reason})`)
				end
			end
		end
	end
	-- 409 = Server noch unbekannt (Heartbeat fehlt) -> später erneut
	flushing = false
end

function EventQueue.size(): number
	return #queue
end

return EventQueue
