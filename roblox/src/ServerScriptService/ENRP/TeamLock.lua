-- Spielrechte und Teamsperre für Privatserver (ModuleScript).
-- Der Heartbeat liefert für verknüpfte Privatserver: teamLock, teamRights { Team = recht }, fallbackTeam und
-- rights { ["UserId"] = { "polizei", … } }. Im Hauptspiel und auf öffentlichen Servern kommt nil → keine Sperre.
-- Bewusst in einfacher Syntax geschrieben (gültiges Luau und Lua 5.1), damit es sich überall prüfen lässt.
--
-- Für eigene Skripte setzt das Modul am Spieler die Attribute ENRP_Rechte (kommagetrennt) und ENRP_<recht> = true.
local Players = game:GetService("Players")
local Teams = game:GetService("Teams")

local TeamLock = {}

local state = nil -- letzte Privatserver-Info aus dem Heartbeat (nil = keine Teamsperre)
local announce = nil
local attributeRights = {} -- [player] = { recht = true } – um entzogene Rechte wieder zu entfernen

local function notify(player, title, text)
	if announce then
		announce:FireClient(player, title, text)
	end
end

local function findTeam(name)
	if type(name) ~= "string" then
		return nil
	end
	for _, team in ipairs(Teams:GetTeams()) do
		if string.lower(team.Name) == string.lower(name) then
			return team
		end
	end
	return nil
end

local function rightsOf(player)
	if not state or type(state.rights) ~= "table" then
		return {}
	end
	return state.rights[tostring(player.UserId)] or {}
end

function TeamLock.hasRight(player, right)
	for _, r in ipairs(rightsOf(player)) do
		if r == right then
			return true
		end
	end
	return false
end

-- Recht, das ein Team bei eingeschalteter Teamsperre verlangt (nil = frei)
local function requiredRight(team)
	if not team or not state or state.teamLock ~= true or type(state.teamRights) ~= "table" then
		return nil
	end
	for name, right in pairs(state.teamRights) do
		if string.lower(name) == string.lower(team.Name) then
			return right
		end
	end
	return nil
end

local function applyAttributes(player)
	local list = rightsOf(player)
	local now = {}
	for _, right in ipairs(list) do
		now[right] = true
		player:SetAttribute("ENRP_" .. right, true)
	end
	for right in pairs(attributeRights[player] or {}) do
		if not now[right] then
			player:SetAttribute("ENRP_" .. right, nil)
		end
	end
	attributeRights[player] = now
	player:SetAttribute("ENRP_Rechte", table.concat(list, ","))
end

-- Spieler ohne Recht aus einem gesperrten Team nehmen
local function enforce(player)
	local right = requiredRight(player.Team)
	if not right or TeamLock.hasRight(player, right) then
		return
	end
	local fallback = state and findTeam(state.fallbackTeam)
	if fallback and fallback ~= player.Team then
		player.Team = fallback
	else
		player.Team = nil
	end
	notify(player, "🔐 Team gesperrt", "Für dieses Team brauchst du auf diesem Privatserver das Spielrecht „" .. right .. "“.")
	task.defer(function()
		if player.Parent then
			player:LoadCharacter()
		end
	end)
end

-- Neue Daten aus dem Heartbeat übernehmen (nil = keine Privatserver-Regeln)
function TeamLock.update(info)
	if type(info) ~= "table" then
		info = nil
	end
	state = info
	for _, player in ipairs(Players:GetPlayers()) do
		applyAttributes(player)
		enforce(player)
	end
end

function TeamLock.init(announceEvent)
	announce = announceEvent
	local function watch(player)
		applyAttributes(player)
		player:GetPropertyChangedSignal("Team"):Connect(function()
			enforce(player)
		end)
		enforce(player)
	end
	Players.PlayerAdded:Connect(watch)
	for _, player in ipairs(Players:GetPlayers()) do
		watch(player)
	end
	Players.PlayerRemoving:Connect(function(player)
		attributeRights[player] = nil
	end)
end

return TeamLock
