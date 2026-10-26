--!strict
-- Dienstsystem im Spiel. Der Client darf nur "start" oder "stop" anfragen; die Fraktion bestimmt
-- ausschließlich das Backend (Profil des verknüpften Accounts). Clientdaten werden nicht übernommen.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Api = require(script.Parent.Api)
local Config = require(script.Parent.Config)
local EventQueue = require(script.Parent.EventQueue)

local Duty = {}

type Profile = { factionKey: string?, rankName: string? }
local profiles: { [number]: Profile } = {}
local onDuty: { [number]: boolean } = {}
local lastRequest: { [number]: number } = {}

-- Lädt Fraktion/Rang beim Beitritt. Unverifizierte Spieler haben keine Fraktion.
function Duty.loadProfile(player: Player)
	local res = Api.request("GET", `/v1/players/roblox:{player.UserId}/profile`)
	if res.ok and type(res.body) == "table" and type(res.body.faction) == "table" then
		profiles[player.UserId] = { factionKey = res.body.faction.key, rankName = res.body.faction.rank and res.body.faction.rank.name }
		player:SetAttribute("EmdenFaction", res.body.faction.key)
		player:SetAttribute("EmdenRank", res.body.faction.rank and res.body.faction.rank.name)
		-- Laufenden Dienst aus Discord übernehmen nur zur Anzeige
		player:SetAttribute("EmdenOnDuty", res.body.onDuty == true)
	else
		profiles[player.UserId] = {}
	end
end

function Duty.start(player: Player): (boolean, string)
	local profile = profiles[player.UserId]
	local faction = profile and profile.factionKey
	if faction == nil or not Config.DutyFactions[faction] then
		return false, "Du bist in keiner Fraktion mit Dienstbetrieb."
	end
	if onDuty[player.UserId] then
		return false, "Du bist bereits im Dienst."
	end
	onDuty[player.UserId] = true
	player:SetAttribute("EmdenOnDuty", true)
	EventQueue.push("duty.start", { robloxUserId = tostring(player.UserId), faction = faction })
	return true, "Dienst begonnen."
end

function Duty.stop(player: Player): (boolean, string)
	if not onDuty[player.UserId] then
		return false, "Du bist nicht im Dienst."
	end
	onDuty[player.UserId] = nil
	player:SetAttribute("EmdenOnDuty", false)
	EventQueue.push("duty.end", { robloxUserId = tostring(player.UserId) })
	return true, "Dienst beendet."
end

function Duty.playerRemoving(player: Player)
	-- Das Backend beendet Spiel-Dienste bei player.leave selbst; hier nur lokalen Zustand aufräumen.
	onDuty[player.UserId] = nil
	profiles[player.UserId] = nil
	lastRequest[player.UserId] = nil
end

-- RemoteFunction für die Dienst-UI. Antwortet mit (erfolg, nachricht).
local remote = Instance.new("RemoteFunction")
remote.Name = "EmdenNetworkDutyRequest"
remote.Parent = ReplicatedStorage
remote.OnServerInvoke = function(player: Player, action: any)
	local now = os.clock()
	if lastRequest[player.UserId] and now - lastRequest[player.UserId] < 3 then
		return false, "Bitte kurz warten."
	end
	lastRequest[player.UserId] = now
	if action == "start" then
		return Duty.start(player)
	elseif action == "stop" then
		return Duty.stop(player)
	end
	return false, "Ungültige Anfrage."
end

Players.PlayerRemoving:Connect(Duty.playerRemoving)

return Duty
