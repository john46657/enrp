-- Leitstelle im Spiel (ModuleScript): Notrufe und Mod-Calls per Chat, Live-Lage für den Heartbeat
-- (Team, Fahndung, Gefängnis, Rufname, Fahrzeuge) und Protokoll-Ereignisse (Kills, Teamwechsel, Fahrzeuge).
-- Bewusst in einfacher Syntax geschrieben (gültiges Luau und Lua 5.1), damit es sich überall prüfen lässt.
--
-- Für eigene Skripte (z. B. ein Handy-UI) gibt es in ServerStorage.ENRP:
--   Notruf:Fire(player, "Polizei", "Text")   ModCall:Fire(player, "Text")   Kill:Fire(opfer, taeter, "Waffe")
-- Attribute am Spieler, die in die Live-Lage einfließen: ENRP_Wanted (0–5), ENRP_Jail (≠ 0 = im Gefängnis),
-- ENRP_Callsign (Rufname). Fahrzeuge: CollectionService-Tag Config.VehicleTag mit den Attributen
-- „Besitzer“ (UserId), optional „Kennzeichen“, „Farbe“, „Modell“ – fehlt das Kennzeichen, wird eins vergeben.
local Players = game:GetService("Players")
local CollectionService = game:GetService("CollectionService")
local TextChatService = game:GetService("TextChatService")
local ServerStorage = game:GetService("ServerStorage")
local Teams = game:GetService("Teams")

local Config = require(script.Parent.Config)
local EventQueue = require(script.Parent.EventQueue)

local Dispatch = {}

local announce = nil -- RemoteEvent „Announcement“ für Rückmeldungen an einzelne Spieler
local callNumber = 0
local lastCall = {}
local lastModCall = {}

local function notify(player, title, text)
	if announce then
		announce:FireClient(player, title, text)
	end
end

local function trim(text)
	return (string.gsub(tostring(text or ""), "^%s*(.-)%s*$", "%1"))
end

local function isPlayer(value)
	return typeof(value) == "Instance" and value:IsA("Player") and value.UserId > 0
end

-- Sofort senden statt auf das nächste Intervall zu warten (Notrufe sollen schnell ankommen)
local function flushSoon()
	task.spawn(function()
		EventQueue.flush()
	end)
end

local function nearestLocation(position)
	local best = nil
	local bestDistance = Config.LocationMaxDistance or 300
	for _, part in ipairs(CollectionService:GetTagged(Config.LocationTag or "ENRPOrt")) do
		if part:IsA("BasePart") then
			local distance = (part.Position - position).Magnitude
			if distance < bestDistance then
				best = part:GetAttribute("Name") or part.Name
				bestDistance = distance
			end
		end
	end
	if best then
		return string.sub(tostring(best), 1, 100)
	end
	return nil
end

-- ===================== Notrufe und Mod-Calls =====================

function Dispatch.emergencyCall(player, department, text)
	if not isPlayer(player) then
		return false
	end
	text = string.sub(trim(text), 1, 400)
	if text == "" then
		notify(player, "🚨 Notruf", "Beschreibe den Notfall, z. B. /notruf Überfall an der Tankstelle")
		return false
	end
	local now = os.time()
	local cooldown = Config.CallCooldownSeconds or 60
	if lastCall[player.UserId] and now - lastCall[player.UserId] < cooldown then
		notify(player, "⏳ Notruf", "Bitte warte kurz bis zum nächsten Notruf.")
		return false
	end
	lastCall[player.UserId] = now
	callNumber = callNumber + 1
	local data = {
		userId = player.UserId,
		username = player.Name,
		department = string.sub(tostring(department or "Polizei"), 1, 40),
		text = text,
		callNumber = callNumber,
	}
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if root then
		data.location = nearestLocation(root.Position)
		data.position = { x = math.floor(root.Position.X), z = math.floor(root.Position.Z) }
	end
	EventQueue.push("emergency_call", data)
	flushSoon()
	notify(player, "🚨 Notruf #" .. callNumber .. " abgesetzt", "Bereich: " .. data.department .. ". Bleib in der Nähe, Hilfe ist unterwegs.")
	return true
end

function Dispatch.modCall(player, text)
	if not isPlayer(player) then
		return false
	end
	local now = os.time()
	local cooldown = Config.ModCallCooldownSeconds or 120
	if lastModCall[player.UserId] and now - lastModCall[player.UserId] < cooldown then
		notify(player, "⏳ Mod-Call", "Bitte warte kurz bis zum nächsten Mod-Call.")
		return false
	end
	lastModCall[player.UserId] = now
	EventQueue.push("mod_call", { userId = player.UserId, username = player.Name, text = string.sub(trim(text), 1, 300) })
	flushSoon()
	notify(player, "🆘 Mod-Call gesendet", "Das Team wurde benachrichtigt.")
	return true
end

local function handleChat(player, message)
	local command, rest = string.match(tostring(message or ""), "^(%S+)%s*(.*)$")
	if not command then
		return
	end
	command = string.lower(command)
	local department = Config.CallCommands and Config.CallCommands[command]
	if department then
		Dispatch.emergencyCall(player, department, rest)
	elseif command == (Config.ModCallCommand or "/modcall") then
		Dispatch.modCall(player, rest)
	end
end

local function setupChatCommands()
	local aliases = {}
	for alias in pairs(Config.CallCommands or {}) do
		table.insert(aliases, alias)
	end
	table.insert(aliases, Config.ModCallCommand or "/modcall")
	if TextChatService.ChatVersion == Enum.ChatVersion.TextChatService then
		for _, alias in ipairs(aliases) do
			local command = Instance.new("TextChatCommand")
			command.Name = "ENRP" .. string.gsub(alias, "%W", "")
			command.PrimaryAlias = alias
			command.Triggered:Connect(function(textSource, message)
				local player = Players:GetPlayerByUserId(textSource.UserId)
				if player then
					handleChat(player, message)
				end
			end)
			command.Parent = TextChatService
		end
	else
		local function hook(player)
			player.Chatted:Connect(function(message)
				handleChat(player, message)
			end)
		end
		Players.PlayerAdded:Connect(hook)
		for _, player in ipairs(Players:GetPlayers()) do
			hook(player)
		end
	end
end

-- ===================== Protokoll: Kills, Teamwechsel, Fahrzeuge =====================

local function reportKill(victim, killer, weapon)
	if not isPlayer(victim) then
		return
	end
	local data = { userId = victim.UserId, username = victim.Name }
	if isPlayer(killer) then
		data.killerId = killer.UserId
		data.killerName = killer.Name
	end
	if weapon then
		data.weapon = string.sub(tostring(weapon), 1, 60)
	end
	EventQueue.push("player_killed", data)
end

local function watchCharacter(player, character)
	local humanoid = character:WaitForChild("Humanoid", 10)
	if not humanoid then
		return
	end
	humanoid.Died:Connect(function()
		-- Übliche Waffen setzen ein ObjectValue „creator“; eigene Systeme können ENRP_LastDamager (UserId) setzen.
		local creator = humanoid:FindFirstChild("creator")
		local killer = creator and creator.Value
		if not isPlayer(killer) then
			local id = character:GetAttribute("ENRP_LastDamager")
			killer = id and Players:GetPlayerByUserId(id) or nil
		end
		local weapon = nil
		if isPlayer(killer) and killer.Character then
			local tool = killer.Character:FindFirstChildOfClass("Tool")
			weapon = tool and tool.Name or nil
		end
		reportKill(player, killer, weapon)
	end)
end

local lastTeam = {}

local function watchPlayer(player)
	lastTeam[player] = player.Team and player.Team.Name or nil
	player:GetPropertyChangedSignal("Team"):Connect(function()
		local now = player.Team and player.Team.Name or nil
		if now ~= lastTeam[player] then
			local data = { userId = player.UserId, username = player.Name }
			if lastTeam[player] then
				data.from = string.sub(lastTeam[player], 1, 40)
			end
			if now then
				data.to = string.sub(now, 1, 40)
			end
			EventQueue.push("team_changed", data)
			lastTeam[player] = now
		end
	end)
	player.CharacterAdded:Connect(function(character)
		watchCharacter(player, character)
	end)
	if player.Character then
		task.spawn(watchCharacter, player, player.Character)
	end
end

local function vehicleInfo(model)
	local info = { model = string.sub(tostring(model:GetAttribute("Modell") or model.Name), 1, 60) }
	local owner = tonumber(model:GetAttribute("Besitzer"))
	if owner and owner > 0 then
		info.ownerId = math.floor(owner)
	end
	local plate = model:GetAttribute("Kennzeichen")
	if type(plate) == "string" and plate ~= "" then
		info.plate = string.sub(plate, 1, 16)
	end
	local color = model:GetAttribute("Farbe")
	if color == nil and model:IsA("Model") then
		local part = model.PrimaryPart or model:FindFirstChildWhichIsA("BasePart", true)
		color = part and part.BrickColor.Name or nil
	end
	if color ~= nil then
		info.color = string.sub(tostring(color), 1, 30)
	end
	return info
end

local function vehicleEvent(eventType, model)
	local info = vehicleInfo(model)
	local data = { model = info.model, plate = info.plate, color = info.color }
	local owner = info.ownerId and Players:GetPlayerByUserId(info.ownerId) or nil
	if owner then
		data.userId = owner.UserId
		data.username = owner.Name
	end
	EventQueue.push(eventType, data)
end

local function onVehicleAdded(model)
	task.delay(1, function() -- dem Spawner Zeit geben, die Attribute zu setzen
		if not model:IsDescendantOf(workspace) then
			return
		end
		if not model:GetAttribute("Kennzeichen") then
			model:SetAttribute("Kennzeichen", string.format("EN-%s%04d", string.char(64 + math.random(1, 26)), math.random(0, 9999)))
		end
		vehicleEvent("vehicle_spawned", model)
	end)
end

-- ===================== Live-Lage für den Heartbeat =====================

-- Spieler mit Team, Fahndungsstufe, Gefängnis und Rufname (Felder, die das Backend kennt)
function Dispatch.playerInfo(player)
	local info = { userId = player.UserId, username = player.Name, displayName = player.DisplayName }
	if player.Team then
		info.team = string.sub(player.Team.Name, 1, 40)
	end
	local wanted = tonumber(player:GetAttribute("ENRP_Wanted"))
	if wanted and wanted > 0 then
		info.wanted = math.clamp(math.floor(wanted), 0, 5)
	end
	local jail = player:GetAttribute("ENRP_Jail")
	if jail ~= nil and jail ~= 0 and jail ~= false then
		info.jailed = true
	end
	local callsign = player:GetAttribute("ENRP_Callsign") or player:GetAttribute("Callsign")
	if type(callsign) == "string" and callsign ~= "" then
		info.callsign = string.sub(callsign, 1, 20)
	end
	return info
end

-- Gespawnte Fahrzeuge (höchstens 300)
function Dispatch.vehicles()
	local list = {}
	for _, model in ipairs(CollectionService:GetTagged(Config.VehicleTag or "ENRPFahrzeug")) do
		if #list >= 300 then
			break
		end
		if model:IsDescendantOf(workspace) then
			table.insert(list, vehicleInfo(model))
		end
	end
	return list
end

function Dispatch.teams()
	local names = {}
	for _, team in ipairs(Teams:GetTeams()) do
		if #names < 50 then
			table.insert(names, string.sub(team.Name, 1, 40))
		end
	end
	return names
end

-- ===================== Start =====================

function Dispatch.init(announceEvent)
	announce = announceEvent
	setupChatCommands()

	Players.PlayerAdded:Connect(watchPlayer)
	for _, player in ipairs(Players:GetPlayers()) do
		watchPlayer(player)
	end
	Players.PlayerRemoving:Connect(function(player)
		lastTeam[player] = nil
		lastCall[player.UserId] = nil
		lastModCall[player.UserId] = nil
	end)

	local tag = Config.VehicleTag or "ENRPFahrzeug"
	CollectionService:GetInstanceAddedSignal(tag):Connect(onVehicleAdded)
	CollectionService:GetInstanceRemovedSignal(tag):Connect(function(model)
		vehicleEvent("vehicle_despawned", model)
	end)
	for _, model in ipairs(CollectionService:GetTagged(tag)) do
		if not model:GetAttribute("Kennzeichen") then
			onVehicleAdded(model)
		end
	end

	-- Schnittstelle für eigene Skripte
	local api = Instance.new("Folder")
	api.Name = "ENRP"
	local function bindable(name, callback)
		local event = Instance.new("BindableEvent")
		event.Name = name
		event.Event:Connect(callback)
		event.Parent = api
	end
	bindable("Notruf", function(player, department, text)
		Dispatch.emergencyCall(player, department, text)
	end)
	bindable("ModCall", function(player, text)
		Dispatch.modCall(player, text)
	end)
	bindable("Kill", function(victim, killer, weapon)
		reportKill(victim, killer, weapon)
	end)
	api.Parent = ServerStorage
end

return Dispatch
