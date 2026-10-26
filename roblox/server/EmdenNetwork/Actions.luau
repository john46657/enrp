--!strict
-- Ausführung kontrollierter Admin-Aufträge aus dem Backend.
-- Es gibt ausschließlich die unten aufgeführten Typen; beliebiger Code wird niemals ausgeführt.
local Players = game:GetService("Players")

local Api = require(script.Parent.Api)
local Announcements = require(script.Parent.Announcements)

local Actions = {}

-- Bereits ausgeführte Auftrags-IDs: verhindert doppelte Ausführung, wenn die Ergebnismeldung
-- fehlschlägt und der Auftrag erneut ausgeliefert wird.
local executed: { [string]: { success: boolean, message: string } } = {}

local function isUserId(v: any): boolean
	return type(v) == "string" and string.match(v, "^[1-9]%d*$") ~= nil and #v <= 19
end

local function isText(v: any, max: number): boolean
	return type(v) == "string" and #v >= 1 and #v <= max
end

type Result = { success: boolean, message: string }

local handlers: { [string]: (payload: any) -> Result } = {
	announce = function(p)
		if not isText(p.message, 200) then
			return { success = false, message = "invalid_payload" }
		end
		local shown = Announcements.broadcast("Emden Network", p.message)
		return { success = shown, message = if shown then "shown" else "filter_failed" }
	end,

	restart_announce = function(p)
		if type(p.minutes) ~= "number" or p.minutes < 1 or p.minutes > 60 then
			return { success = false, message = "invalid_payload" }
		end
		local shown = Announcements.broadcast("Emden Network", `Server-Neustart in {math.floor(p.minutes)} Minuten.`)
		return { success = shown, message = if shown then "shown" else "filter_failed" }
	end,

	kick = function(p)
		if not isUserId(p.robloxUserId) or not isText(p.reason, 200) then
			return { success = false, message = "invalid_payload" }
		end
		local player = Players:GetPlayerByUserId(tonumber(p.robloxUserId) :: number)
		if not player then
			return { success = false, message = "not_present" }
		end
		player:Kick(`Emden Network: {p.reason}`)
		return { success = true, message = "kicked" }
	end,

	ban = function(p)
		if not isUserId(p.robloxUserId) or not isText(p.reason, 200) then
			return { success = false, message = "invalid_payload" }
		end
		local duration = p.durationSeconds
		if duration ~= nil and (type(duration) ~= "number" or duration < 1) then
			return { success = false, message = "invalid_payload" }
		end
		local ok, err = pcall(function()
			Players:BanAsync({
				UserIds = { tonumber(p.robloxUserId) :: number },
				ApplyToUniverse = true,
				-- -1 = dauerhaft (laut Roblox-Referenz zu BanAsync)
				Duration = if duration == nil then -1 else duration,
				DisplayReason = p.reason,
				PrivateReason = "Emden Network: Bann über Discord-Backend",
				ExcludeAltAccounts = false,
			})
		end)
		if not ok then
			warn(`[EmdenNetwork] BanAsync fehlgeschlagen: {tostring(err)}`)
			return { success = false, message = "ban_failed" }
		end
		return { success = true, message = "banned" }
	end,

	unban = function(p)
		if not isUserId(p.robloxUserId) then
			return { success = false, message = "invalid_payload" }
		end
		local ok, err = pcall(function()
			Players:UnbanAsync({ UserIds = { tonumber(p.robloxUserId) :: number }, ApplyToUniverse = true })
		end)
		if not ok then
			warn(`[EmdenNetwork] UnbanAsync fehlgeschlagen: {tostring(err)}`)
			return { success = false, message = "unban_failed" }
		end
		return { success = true, message = "unbanned" }
	end,
}

local function expired(expiresAt: any): boolean
	if type(expiresAt) ~= "string" then
		return true
	end
	local ok, dt = pcall(DateTime.fromIsoDate, expiresAt)
	if not ok or dt == nil then
		return true
	end
	return DateTime.now().UnixTimestamp >= dt.UnixTimestamp
end

local function report(id: string, result: Result)
	Api.request("POST", `/v1/game/actions/{id}/result`, { jobId = Api.JobId, success = result.success, message = result.message })
end

-- Holt freigegebene Aufträge ab und führt sie aus.
function Actions.poll()
	local res = Api.request("GET", `/v1/game/actions?jobId={Api.JobId}`)
	if not res.ok or type(res.body) ~= "table" or type(res.body.actions) ~= "table" then
		return
	end
	for _, action in res.body.actions do
		local id = action.id
		if type(id) ~= "string" or not string.match(id, "^[%x%-]+$") then
			continue
		end
		local result = executed[id]
		if result == nil then
			local handler = handlers[action.type]
			if handler == nil then
				result = { success = false, message = "unknown_type" }
			elseif expired(action.expiresAt) then
				result = { success = false, message = "expired" }
			elseif type(action.payload) ~= "table" then
				result = { success = false, message = "invalid_payload" }
			else
				local ok, r = pcall(handler, action.payload)
				result = if ok then r else { success = false, message = "handler_error" }
			end
			executed[id] = result
		end
		report(id, result :: Result)
	end
end

return Actions
