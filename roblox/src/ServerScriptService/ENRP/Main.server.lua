--!strict
-- Einstiegspunkt der ENRP-Integration (Script in ServerScriptService/ENRP).
-- Voraussetzungen: Spieleinstellungen → Sicherheit → „HTTP-Anfragen zulassen“ aktiv,
-- Secret ENRP_API_KEY im Creator Hub hinterlegt (siehe roblox/README.md).
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")

local Api = require(script.Parent.Api)
local Config = require(script.Parent.Config)
local Duty = require(script.Parent.Duty)
local EventQueue = require(script.Parent.EventQueue)
local Rewards = require(script.Parent.Rewards)

-- Remotes für Clients (keine Geheimnisse, jede Anfrage wird serverseitig geprüft).
local remotes = Instance.new("Folder")
remotes.Name = "ENRP"
remotes.Parent = ReplicatedStorage
local announce = Instance.new("RemoteEvent")
announce.Name = "Announcement"
announce.Parent = remotes
local maintenanceEvent = Instance.new("RemoteEvent")
maintenanceEvent.Name = "Maintenance"
maintenanceEvent.Parent = remotes
local dutyToggle = Instance.new("RemoteFunction")
dutyToggle.Name = "DutyToggle"
dutyToggle.Parent = remotes
local redeemCode = Instance.new("RemoteFunction")
redeemCode.Name = "RedeemCode"
redeemCode.Parent = remotes

local state = {
	killSwitch = false,
	maintenance = { active = false, message = nil :: string? },
	announcementsSince = DateTime.now():ToIsoDate(),
	handledSanctions = {} :: { [string]: boolean },
	connected = false,
}

dutyToggle.OnServerInvoke = function(player: Player)
	if state.killSwitch then
		return false, "Diese Funktion ist vorübergehend gesperrt."
	end
	return Duty.toggleRequest(player)
end

redeemCode.OnServerInvoke = function(player: Player, code: any)
	if state.killSwitch or state.maintenance.active then
		return false, "Diese Funktion ist vorübergehend gesperrt."
	end
	if typeof(code) ~= "string" then
		return false, "Ungültige Eingabe."
	end
	return Rewards.redeem(player, string.upper(string.gsub(code, "%s", "")))
end

-- Zugangsprüfung beim Betreten: Bann (Backend maßgeblich), Fraktion, erlaubte Fahrzeuge.
local function checkAccess(player: Player)
	local response = Api.request("POST", "/api/v1/game/players/access", { jobId = game.JobId, userId = player.UserId })
	if not response.ok then
		if Config.DenyJoinWhenBackendDown then
			player:Kick("Die Spielerprüfung ist gerade nicht erreichbar. Bitte versuche es gleich erneut.")
		end
		return
	end
	local access = response.body
	if not access.allowed then
		local until_ = access.ban and access.ban.expiresAt and (" bis " .. access.ban.expiresAt) or ""
		player:Kick(("Du bist gesperrt%s. Grund: %s (Aktion #%s). Einspruch über Discord: /appeal create"):format(until_, tostring(access.ban and access.ban.reason), tostring(access.ban and access.ban.number)))
		return
	end
	Duty.setFaction(player, access.faction and access.faction.key or nil)
	local vehicles = {}
	for _, v in access.vehicles or {} do
		table.insert(vehicles, v.identifier)
	end
	-- Andere Spielskripte lesen erlaubte Fahrzeuge über dieses Attribut (kommagetrennte Kennungen).
	player:SetAttribute("ENRP_Vehicles", table.concat(vehicles, ","))
end

Players.PlayerAdded:Connect(function(player)
	EventQueue.push("player_joined", { userId = player.UserId, username = player.Name, displayName = player.DisplayName })
	task.spawn(checkAccess, player)
	if state.maintenance.active then
		maintenanceEvent:FireClient(player, state.maintenance.message)
	end
end)

Players.PlayerRemoving:Connect(function(player)
	EventQueue.push("player_left", { userId = player.UserId, username = player.Name })
end)

-- Sanktionen ausführen, die das Backend für Roblox angeordnet hat (Players:BanAsync/UnbanAsync, Kick).
local function applySanction(sanction: any)
	if state.handledSanctions[sanction.id] then
		return
	end
	state.handledSanctions[sanction.id] = true
	local userId = sanction.robloxUserId
	local ok, err = pcall(function()
		if sanction.type == "ban" then
			local duration = -1
			if sanction.expiresAt then
				local expires = DateTime.fromIsoDate(sanction.expiresAt)
				duration = if expires then math.max(60, math.floor((expires.UnixTimestampMillis - DateTime.now().UnixTimestampMillis) / 1000)) else -1
			end
			Players:BanAsync({
				UserIds = { userId },
				ApplyToUniverse = true,
				Duration = duration,
				DisplayReason = ("%s (Aktion #%s)"):format(sanction.reason, tostring(sanction.number)),
				PrivateReason = "ENRP Moderationsaktion " .. tostring(sanction.id),
				ExcludeAltAccounts = false,
			})
		elseif sanction.type == "unban" then
			Players:UnbanAsync({ UserIds = { userId }, ApplyToUniverse = true })
		elseif sanction.type == "kick" then
			local player = Players:GetPlayerByUserId(userId)
			if player then
				player:Kick("Du wurdest vom Server entfernt. Grund: " .. sanction.reason)
			end
		end
	end)
	if not ok then
		warn("[ENRP] Sanktion fehlgeschlagen: " .. tostring(err))
	end
	Api.request("POST", ("/api/v1/game/sanctions/%s/ack"):format(sanction.id), { jobId = game.JobId, success = ok, error = if ok then nil else tostring(err) })
end

local function heartbeat()
	local players = {}
	for _, p in Players:GetPlayers() do
		table.insert(players, { userId = p.UserId, username = p.Name, displayName = p.DisplayName })
	end
	local response = Api.request("POST", "/api/v1/game/heartbeat", {
		jobId = game.JobId,
		placeId = tostring(game.PlaceId),
		placeVersion = game.PlaceVersion,
		maxPlayers = Players.MaxPlayers,
		players = players,
		announcementsSince = state.announcementsSince,
	})
	state.connected = response.ok
	if not response.ok then
		warn("[ENRP] Heartbeat fehlgeschlagen: " .. tostring(response.errorCode or response.status))
		return
	end
	local data = response.body
	state.killSwitch = data.killSwitch == true
	local wasMaintenance = state.maintenance.active
	state.maintenance = { active = data.maintenance.active == true, message = data.maintenance.message }
	if state.maintenance.active and not wasMaintenance then
		maintenanceEvent:FireAllClients(state.maintenance.message or "Wartungsarbeiten laufen.")
	elseif wasMaintenance and not state.maintenance.active then
		maintenanceEvent:FireAllClients(nil)
	end
	for _, a in data.announcements or {} do
		announce:FireAllClients(a.title, a.body)
		if a.publishedAt then
			state.announcementsSince = a.publishedAt
		end
	end
	for _, sanction in data.sanctions or {} do
		task.spawn(applySanction, sanction)
	end
end

-- Hintergrundschleifen mit festen Intervallen (Roblox-Server können keine eingehenden Verbindungen annehmen).
task.spawn(function()
	heartbeat()
	while true do
		task.wait(Config.HeartbeatIntervalSeconds)
		heartbeat()
	end
end)

task.spawn(function()
	while true do
		task.wait(Config.EventFlushIntervalSeconds)
		if state.connected or EventQueue.size() > 0 then
			EventQueue.flush()
		end
	end
end)

-- Beim Herunterfahren: ausstehende Ereignisse senden und Server abmelden (max. 30 s erlaubt).
game:BindToClose(function()
	for _ = 1, 3 do
		if EventQueue.size() == 0 then
			break
		end
		EventQueue.flush()
	end
	Api.request("POST", "/api/v1/game/shutdown", { jobId = game.JobId })
end)

if not HttpService.HttpEnabled then
	warn("[ENRP] HTTP-Anfragen sind deaktiviert. Spieleinstellungen → Sicherheit → „HTTP-Anfragen zulassen“.")
end
