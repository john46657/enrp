-- Ingame-Aktionen aus Dashboard und Discord (ModuleScript): Heilen, Töten, Respawn, Gefängnis, Fahndungsstufe, Team,
-- Kick (nur Privatserver-Teams).
-- Das Backend legt sie als Server-Befehle an; Main.server.lua holt sie ab und ruft Actions.run auf.
-- Bewusst in einfacher Syntax geschrieben (gültiges Luau und Lua 5.1), damit es sich überall prüfen lässt.
--
-- Gefängnis: Attribut ENRP_Jail = Entlass-Zeitpunkt (os.time()), 0 = frei. Der Spieler wird zu einem Part mit dem
-- Tag Config.JailTag teleportiert (auch nach jedem Respawn) und optional ins Team Config.JailTeam gesetzt.
-- Eigene Skripte können ENRP_Jail lesen oder über ServerStorage.ENRP.Gefaengnis:Fire(player, minuten) selbst einsperren.
local Players = game:GetService("Players")
local CollectionService = game:GetService("CollectionService")
local ServerStorage = game:GetService("ServerStorage")
local Teams = game:GetService("Teams")

local Config = require(script.Parent.Config)

local Actions = {}

local announce = nil
local previousTeam = {} -- Team vor dem Gefängnis, um es beim Entlassen wiederherzustellen

local HANDLED = { heal = true, kill = true, respawn = true, jail = true, unjail = true, wanted = true, team = true, kick = true }

function Actions.handles(commandType)
	return HANDLED[commandType] == true
end

local function notify(player, title, text)
	if announce and text then
		announce:FireClient(player, title, text)
	end
end

local function humanoidOf(player)
	local character = player.Character
	return character and character:FindFirstChildOfClass("Humanoid")
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

local function jailSpot()
	local spots = {}
	for _, part in ipairs(CollectionService:GetTagged(Config.JailTag or "ENRPGefaengnis")) do
		if part:IsA("BasePart") and part:IsDescendantOf(workspace) then
			table.insert(spots, part)
		end
	end
	if #spots == 0 then
		return nil
	end
	return spots[math.random(1, #spots)]
end

local function isJailed(player)
	local value = tonumber(player:GetAttribute("ENRP_Jail"))
	return value ~= nil and value > 0
end

-- Gefangene an einen Gefängnis-Part setzen (nach dem Spawnen kurz warten, bis der Charakter steht)
local function placeInJail(player)
	local spot = jailSpot()
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if spot and root then
		character:PivotTo(spot.CFrame + Vector3.new(0, 3, 0))
	end
end

function Actions.jail(player, minutes)
	minutes = math.clamp(math.floor(tonumber(minutes) or 5), 1, 240)
	player:SetAttribute("ENRP_Jail", os.time() + minutes * 60)
	local jailTeam = findTeam(Config.JailTeam)
	if jailTeam and player.Team ~= jailTeam then
		previousTeam[player] = player.Team
		player.Team = jailTeam
	end
	placeInJail(player)
end

function Actions.unjail(player)
	if not isJailed(player) then
		return false
	end
	player:SetAttribute("ENRP_Jail", 0)
	local jailTeam = findTeam(Config.JailTeam)
	if jailTeam and player.Team == jailTeam then
		player.Team = previousTeam[player] or findTeam(Config.ReleaseTeam)
	end
	previousTeam[player] = nil
	player:LoadCharacter()
	return true
end

-- Führt einen Befehl aus. Fehler werden geworfen und von Main.server.lua an das Backend gemeldet.
function Actions.run(command)
	local player = Players:GetPlayerByUserId(command.robloxUserId)
	if not player then
		error("Spieler ist nicht auf diesem Server")
	end
	local params = command.params or {}
	local kind = command.type
	if kind == "heal" then
		local humanoid = humanoidOf(player)
		if not humanoid then
			error("Spieler hat keinen Charakter")
		end
		humanoid.Health = humanoid.MaxHealth
	elseif kind == "kill" then
		local humanoid = humanoidOf(player)
		if not humanoid then
			error("Spieler hat keinen Charakter")
		end
		humanoid.Health = 0
	elseif kind == "kick" then
		-- Nur vom Privatserver-Team (das Backend lässt es nur auf eigenen Privatservern zu)
		player:Kick(command.message or "Du wurdest vom Server entfernt.")
		return
	elseif kind == "respawn" then
		player:LoadCharacter()
	elseif kind == "jail" then
		Actions.jail(player, params.minutes)
	elseif kind == "unjail" then
		if not Actions.unjail(player) then
			error("Spieler ist nicht im Gefängnis")
		end
	elseif kind == "wanted" then
		player:SetAttribute("ENRP_Wanted", math.clamp(math.floor(tonumber(params.level) or 0), 0, 5))
	elseif kind == "team" then
		local team = findTeam(params.team)
		if not team then
			error("Team nicht gefunden: " .. tostring(params.team))
		end
		player.Team = team
		player:LoadCharacter()
	else
		error("Unbekannte Aktion: " .. tostring(kind))
	end
	notify(player, "Hinweis vom Team", command.message)
end

function Actions.init(announceEvent)
	announce = announceEvent

	local function watch(player)
		player.CharacterAdded:Connect(function()
			if isJailed(player) then
				task.wait(0.5)
				placeInJail(player)
			end
		end)
	end
	Players.PlayerAdded:Connect(watch)
	for _, player in ipairs(Players:GetPlayers()) do
		watch(player)
	end
	Players.PlayerRemoving:Connect(function(player)
		previousTeam[player] = nil
	end)

	-- Abgelaufene Gefängnisstrafen beenden
	task.spawn(function()
		while true do
			task.wait(5)
			local now = os.time()
			for _, player in ipairs(Players:GetPlayers()) do
				local untilTime = tonumber(player:GetAttribute("ENRP_Jail"))
				if untilTime and untilTime > 0 and now >= untilTime then
					Actions.unjail(player)
					notify(player, "🔓 Entlassen", "Deine Zeit im Gefängnis ist vorbei.")
				end
			end
		end
	end)

	-- Schnittstelle für eigene Skripte (gleicher Ordner wie Dispatch: ServerStorage.ENRP)
	local api = ServerStorage:FindFirstChild("ENRP")
	if not api then
		api = Instance.new("Folder")
		api.Name = "ENRP"
		api.Parent = ServerStorage
	end
	local jailEvent = Instance.new("BindableEvent")
	jailEvent.Name = "Gefaengnis"
	jailEvent.Event:Connect(function(player, minutes)
		if typeof(player) == "Instance" and player:IsA("Player") then
			Actions.jail(player, minutes)
		end
	end)
	jailEvent.Parent = api
end

return Actions
