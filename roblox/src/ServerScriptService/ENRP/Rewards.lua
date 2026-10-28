--!strict
-- Vergabe von Code-Belohnungen. Das Backend prüft Gültigkeit, Limits und Doppelungen;
-- das Spiel vergibt die Belohnung serverseitig über die hier registrierten Handler.
--
-- Eigene Belohnungstypen registrieren (z. B. in einem anderen Server-Skript):
--   local Rewards = require(game.ServerScriptService.ENRP.Rewards)
--   Rewards.register("cash", function(player, payload) ... return true end)
local Players = game:GetService("Players")
local Api = require(script.Parent.Api)
local Config = require(script.Parent.Config)
local EventQueue = require(script.Parent.EventQueue)

local Rewards = {}
local handlers: { [string]: (Player, { [string]: any }) -> boolean } = {}
local lastAttempt: { [number]: number } = {}

local MESSAGES = {
	invalid_code = "Dieser Code ist ungültig.",
	not_started = "Dieser Code ist noch nicht gültig.",
	expired = "Dieser Code ist abgelaufen.",
	disabled = "Dieser Code ist deaktiviert.",
	exhausted = "Dieser Code wurde bereits zu oft eingelöst.",
	user_limit = "Du hast diesen Code bereits eingelöst.",
	feature_disabled = "Das Einlösen von Codes ist derzeit deaktiviert.",
}

function Rewards.register(rewardType: string, handler: (Player, { [string]: any }) -> boolean)
	handlers[rewardType] = handler
end

function Rewards.redeem(player: Player, code: string): (boolean, string)
	if typeof(code) ~= "string" or #code < 4 or #code > 40 then
		return false, MESSAGES.invalid_code
	end
	local now = os.clock()
	if lastAttempt[player.UserId] and now - lastAttempt[player.UserId] < Config.RedeemCooldownSeconds then
		return false, "Bitte kurz warten."
	end
	lastAttempt[player.UserId] = now

	-- Ein Idempotenzschlüssel pro Versuch: Netzwerk-Wiederholungen führen nicht zu doppelten Einlösungen.
	local key = Api.newId()
	local response = Api.request("POST", "/api/v1/game/redeem", { jobId = Api.jobId(), userId = player.UserId, code = code }, key)
	if not response.ok then
		return false, "Der Code konnte gerade nicht geprüft werden. Bitte später erneut versuchen."
	end
	local result = response.body
	if result.status ~= "redeemed" then
		return false, MESSAGES[result.reason] or "Einlösen nicht möglich."
	end
	local handler = handlers[result.rewardType]
	if handler == nil then
		warn("[ENRP] Kein Handler für Belohnungstyp " .. tostring(result.rewardType))
		return false, "Diese Belohnung kann in diesem Spiel nicht vergeben werden. Bitte melde dich beim Team."
	end
	local ok, granted = pcall(handler, player, result.rewardPayload or {})
	if not ok or not granted then
		warn("[ENRP] Belohnung konnte nicht vergeben werden: " .. tostring(granted))
		return false, "Die Belohnung konnte nicht vergeben werden. Bitte melde dich beim Team."
	end
	EventQueue.push("redemption_delivered", { userId = player.UserId, redemptionId = result.redemptionId })
	return true, "Code eingelöst!"
end

Players.PlayerRemoving:Connect(function(player)
	lastAttempt[player.UserId] = nil
end)

return Rewards
