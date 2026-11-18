-- Aktionen an Spielern aus Dashboard oder Discord (Server-Befehl „player_action“): Gefängnis, Entlassen,
-- Fahndungsstufe, Heilen, Töten, Respawn, Team, private Nachricht, Kick.
-- Bewusst in einfacher Syntax geschrieben (gültiges Luau und Lua 5.1).
--
-- Gefängnis: Attribut ENRP_Jail = Entlassungszeit (os.time). Gibt es ein Part mit dem CollectionService-Tag
-- Config.JailTag („ENRPGefaengnis“), wird der Spieler dorthin gesetzt (auch nach jedem Respawn), entlassen wird
-- an Config.ReleaseTag („ENRPEntlassung“) oder per Respawn.
-- Eigene Systeme können zusätzlich auf ServerStorage.ENRP.Aktion hören: Aktion.Event:Connect(function(player, action, payload) … end)
local Players = game:GetService("Players")
local CollectionService = game:GetService("CollectionService")
local ServerStorage = game:GetService("ServerStorage")
local Teams = game:GetService("Teams")

local Config = require(script.Parent.Config)

local Actions = {}

local announce = nil
local hook = nil -- BindableEvent für eigene Skripte

local function notify(player, title, text)
	if announce then
		announce:FireClient(player, title, text)
	end
end

local function humanoidOf(player)
	local character = player.Character
	return character and character:FindFirstChildOfClass("Humanoid") or nil
end

local function moveTo(player, tag)
	local spots = CollectionService:GetTagged(tag)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if #spots == 0 or not root then
		return false
	end
	local spot = spots[math.random(1, #spots)]
	if spot:IsA("BasePart") then
		character:PivotTo(spot.CFrame + Vector3.new(0, 3, 0))
		return true
	end
	return false
end

local function jailedUntil(player)
	local value = tonumber(player:GetAttribute("ENRP_Jail"))
	if value and value > os.time() then
		return value
	end
	return nil
end

local function release(player)
	player:SetAttribute("ENRP_Jail", nil)
	if not moveTo(player, Config.ReleaseTag or "ENRPEntlassung") then
		player:LoadCharacter()
	end
	notify(player, "🔓 Entlassen", "Du bist wieder frei.")
end

local handlers = {}

function handlers.jail(player, payload)
	local minutes = math.clamp(math.floor(tonumber(payload.minutes) or 5), 1, 120)
	player:SetAttribute("ENRP_Jail", os.time() + minutes * 60)
	player:SetAttribute("ENRP_Wanted", 0)
	moveTo(player, Config.JailTag or "ENRPGefaengnis")
	notify(player, "🔒 Gefängnis", "Du sitzt " .. minutes .. " Minuten im Gefängnis.")
end

function handlers.unjail(player)
	if player:GetAttribute("ENRP_Jail") == nil then
		error("Spieler ist nicht im Gefängnis")
	end
	release(player)
end

function handlers.wanted(player, payload)
	local level = math.clamp(math.floor(tonumber(payload.level) or 0), 0, 5)
	player:SetAttribute("ENRP_Wanted", level)
	if level > 0 then
		notify(player, "⭐ Fahndung", "Du wirst mit Stufe " .. level .. " gesucht.")
	end
end

function handlers.heal(player)
	local humanoid = humanoidOf(player)
	if not humanoid or humanoid.Health <= 0 then
		error("Spieler hat keinen lebenden Charakter")
	end
	humanoid.Health = humanoid.MaxHealth
	notify(player, "❤️ Geheilt", "Ein Teammitglied hat dich geheilt.")
end

function handlers.kill(player)
	local humanoid = humanoidOf(player)
	if not humanoid then
		error("Spieler hat keinen Charakter")
	end
	humanoid.Health = 0
end

function handlers.respawn(player)
	player:LoadCharacter()
end

function handlers.team(player, payload)
	local wanted = string.lower(tostring(payload.team or ""))
	for _, team in ipairs(Teams:GetTeams()) do
		if string.lower(team.Name) == wanted then
			-- Vom Team gesetzt: gilt auch bei aktiver Teamsperre (Privat-Server) als erlaubt.
			player:SetAttribute("ENRP_TeamOverride", team.Name)
			player.Team = team
			player.Neutral = false
			player:LoadCharacter()
			notify(player, "👕 Team gewechselt", "Du bist jetzt im Team " .. team.Name .. ".")
			return
		end
	end
	error("Team nicht gefunden: " .. tostring(payload.team))
end

function handlers.pm(player, _, message)
	notify(player, "✉️ Nachricht vom Team", tostring(message or ""))
end

function handlers.kick(player, _, message)
	player:Kick("Vom Team gekickt: " .. tostring(message or "ohne Grund"))
end

-- Führt eine Aktion aus; Fehler (Spieler weg, Team unbekannt …) werden an den Aufrufer weitergereicht und
-- dort als „fehlgeschlagen“ an das Backend bestätigt.
function Actions.apply(command)
	local player = Players:GetPlayerByUserId(command.robloxUserId)
	if not player then
		error("Spieler ist nicht auf diesem Server")
	end
	local handler = handlers[command.action]
	if not handler then
		error("Unbekannte Aktion: " .. tostring(command.action))
	end
	local payload = command.payload or {}
	handler(player, payload, command.message)
	if hook then
		hook:Fire(player, command.action, payload)
	end
end

function Actions.init(announceEvent)
	announce = announceEvent

	local folder = ServerStorage:FindFirstChild("ENRP")
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = "ENRP"
		folder.Parent = ServerStorage
	end
	hook = Instance.new("BindableEvent")
	hook.Name = "Aktion"
	hook.Parent = folder

	-- Wer im Gefängnis respawnt, landet wieder dort
	local function watch(player)
		player.CharacterAdded:Connect(function()
			if jailedUntil(player) then
				task.wait(0.5)
				moveTo(player, Config.JailTag or "ENRPGefaengnis")
			end
		end)
	end
	Players.PlayerAdded:Connect(watch)
	for _, player in ipairs(Players:GetPlayers()) do
		watch(player)
	end

	-- Abgelaufene Haftzeiten automatisch beenden
	task.spawn(function()
		while true do
			task.wait(5)
			for _, player in ipairs(Players:GetPlayers()) do
				local value = player:GetAttribute("ENRP_Jail")
				if value ~= nil and not jailedUntil(player) then
					release(player)
				end
			end
		end
	end)
end

return Actions
