--!strict
-- Dienstsystem auf dem Spielserver. Der Client darf Dienst nur ANFRAGEN; der Server prüft Fraktion und
-- Abstand, meldet das Ereignis, und das Backend entscheidet endgültig (Serverzeit, Mitgliedschaft).
local Players = game:GetService("Players")
local Config = require(script.Parent.Config)
local EventQueue = require(script.Parent.EventQueue)

local Duty = {}
local onDuty: { [number]: boolean } = {}
local lastToggle: { [number]: number } = {}
-- Vom Backend beim Betreten gemeldete Fraktion (maßgeblich, nicht vom Client).
local factionOf: { [number]: string? } = {}

function Duty.setFaction(player: Player, factionKey: string?)
	factionOf[player.UserId] = factionKey
	player:SetAttribute("ENRP_Faction", factionKey)
	if onDuty[player.UserId] and factionKey ~= nil and not Config.DutyFactions[factionKey] then
		Duty.stop(player)
	end
end

function Duty.isOnDuty(player: Player): boolean
	return onDuty[player.UserId] == true
end

function Duty.start(player: Player): (boolean, string?)
	local faction = factionOf[player.UserId]
	if faction == nil or not Config.DutyFactions[faction] then
		return false, "Du gehörst keiner Fraktion mit Dienstsystem an."
	end
	if onDuty[player.UserId] then
		return false, "Du bist bereits im Dienst."
	end
	onDuty[player.UserId] = true
	player:SetAttribute("ENRP_OnDuty", true)
	EventQueue.push("duty_start", { userId = player.UserId, username = player.Name, faction = faction })
	return true, nil
end

function Duty.stop(player: Player): (boolean, string?)
	if not onDuty[player.UserId] then
		return false, "Du bist nicht im Dienst."
	end
	onDuty[player.UserId] = nil
	player:SetAttribute("ENRP_OnDuty", false)
	EventQueue.push("duty_end", { userId = player.UserId, username = player.Name })
	return true, nil
end

-- Wird von der RemoteFunction aufgerufen; begrenzt die Häufigkeit pro Spieler.
function Duty.toggleRequest(player: Player): (boolean, string?)
	local now = os.clock()
	local last = lastToggle[player.UserId]
	if last and now - last < Config.DutyToggleCooldownSeconds then
		return false, "Bitte kurz warten."
	end
	lastToggle[player.UserId] = now
	if onDuty[player.UserId] then
		return Duty.stop(player)
	end
	return Duty.start(player)
end

-- Beim Verlassen beendet das Backend den Dienst selbst (player_left); hier nur lokalen Zustand aufräumen.
Players.PlayerRemoving:Connect(function(player)
	onDuty[player.UserId] = nil
	lastToggle[player.UserId] = nil
	factionOf[player.UserId] = nil
end)

return Duty
