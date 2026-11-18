-- Teamsperre für Privat-Server (Extra-Funktion, standardmäßig aus).
-- Im Hauptspiel greift sie NIE: dort darf jeder in jedes Team (auch Polizei); gezählter Dienst bleibt
-- trotzdem Fraktionsmitgliedern vorbehalten (siehe Duty.lua).
-- Auf einem Privat-Server kann der Besitzer im Dashboard (Privat-Server) einstellen, welche Teams nur
-- Mitgliedern einer Fraktion offenstehen (Team-Name → Fraktionsschlüssel). Die Einstellung kommt mit
-- jedem Heartbeat (heartbeat.privateServer). Die Fraktion eines Spielers meldet das Backend beim Betreten
-- (Attribut ENRP_Faction). Wechselt jemand ohne passende Fraktion in ein gesperrtes Team, wird er auf sein
-- vorheriges Team zurückgesetzt (sonst Config.TeamLockFallbackTeam bzw. neutral) und bekommt einen Hinweis.
-- Bewusst in einfacher Syntax geschrieben (gültiges Luau und Lua 5.1).
local Players = game:GetService("Players")
local Teams = game:GetService("Teams")

local Config = require(script.Parent.Config)

local TeamLock = {}

local announce = nil
local enabled = false
local teamFactions = {} -- kleingeschriebener Team-Name → Fraktionsschlüssel
local lastAllowed = {} -- UserId → zuletzt erlaubtes Team (oder false = neutral)
local resetting = {} -- UserId → true, während wir selbst zurücksetzen

local function requiredFaction(team)
	if not enabled or not team then
		return nil
	end
	return teamFactions[string.lower(team.Name)]
end

local function findTeam(name)
	if not name then
		return nil
	end
	local wanted = string.lower(name)
	for _, team in ipairs(Teams:GetTeams()) do
		if string.lower(team.Name) == wanted then
			return team
		end
	end
	return nil
end

-- Darf der Spieler in diesem Team sein? Vom Team gesetzte Teams (Aktion „team“) sind immer erlaubt.
function TeamLock.isAllowed(player, team)
	local needed = requiredFaction(team)
	if not needed then
		return true
	end
	if team and player:GetAttribute("ENRP_TeamOverride") == team.Name then
		return true
	end
	return player:GetAttribute("ENRP_Faction") == needed
end

local function reset(player, team)
	resetting[player.UserId] = true
	local previous = lastAllowed[player.UserId]
	local target = nil
	if previous and previous.Parent == Teams and TeamLock.isAllowed(player, previous) then
		target = previous
	else
		target = findTeam(Config.TeamLockFallbackTeam)
		if target and not TeamLock.isAllowed(player, target) then
			target = nil
		end
	end
	if target then
		player.Team = target
		player.Neutral = false
	else
		player.Team = nil
		player.Neutral = true
	end
	resetting[player.UserId] = nil
	if announce then
		announce:FireClient(
			player,
			"🔒 Team gesperrt",
			"Das Team " .. team.Name .. " ist auf diesem Privat-Server nur für Mitglieder der passenden Fraktion."
		)
	end
end

local function check(player)
	if resetting[player.UserId] then
		return
	end
	local team = player.Team
	if player.Neutral then
		team = nil
	end
	-- Freigabe durch das Team gilt nur, solange der Spieler in genau diesem Team bleibt.
	local override = player:GetAttribute("ENRP_TeamOverride")
	if override and (not team or team.Name ~= override) then
		player:SetAttribute("ENRP_TeamOverride", nil)
	end
	if team and not TeamLock.isAllowed(player, team) then
		reset(player, team)
	else
		lastAllowed[player.UserId] = team or false
	end
end

local function watch(player)
	player:GetPropertyChangedSignal("Team"):Connect(function()
		check(player)
	end)
	-- Fraktion kommt erst nach der Zugangsprüfung: dann erneut prüfen
	player:GetAttributeChangedSignal("ENRP_Faction"):Connect(function()
		check(player)
	end)
	check(player)
end

-- Einstellung aus der Heartbeat-Antwort übernehmen (nil im Hauptspiel → Sperre aus).
function TeamLock.configure(privateServer)
	local map = {}
	local on = false
	if type(privateServer) == "table" and privateServer.teamLock == true and type(privateServer.teamFactions) == "table" then
		for teamName, factionKey in pairs(privateServer.teamFactions) do
			if type(teamName) == "string" and type(factionKey) == "string" then
				map[string.lower(teamName)] = factionKey
				on = true
			end
		end
	end
	local changed = on ~= enabled
	if not changed then
		for k, v in pairs(map) do
			if teamFactions[k] ~= v then
				changed = true
			end
		end
		for k, v in pairs(teamFactions) do
			if map[k] ~= v then
				changed = true
			end
		end
	end
	enabled = on
	teamFactions = map
	if changed then
		for _, player in ipairs(Players:GetPlayers()) do
			check(player)
		end
	end
end

function TeamLock.isEnabled()
	return enabled
end

function TeamLock.init(announceEvent)
	announce = announceEvent
	-- Nur auf Privat-Servern (game.PrivateServerOwnerId ~= 0) überhaupt beobachten.
	if game.PrivateServerId == "" or game.PrivateServerOwnerId == 0 then
		return
	end
	Players.PlayerAdded:Connect(watch)
	for _, player in ipairs(Players:GetPlayers()) do
		watch(player)
	end
	Players.PlayerRemoving:Connect(function(player)
		lastAllowed[player.UserId] = nil
		resetting[player.UserId] = nil
	end)
end

return TeamLock
