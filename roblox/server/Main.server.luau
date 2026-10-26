--!strict
-- Emden Network – Einstiegspunkt der Spielintegration (Script in ServerScriptService).
local Players = game:GetService("Players")

local Modules = script.Parent:WaitForChild("EmdenNetwork")
local Api = require(Modules.Api)
local Config = require(Modules.Config)
local EventQueue = require(Modules.EventQueue)
local Actions = require(Modules.Actions)
local Duty = require(Modules.Duty)

local maintenance = { enabled = false, message = nil :: string? }
local shuttingDown = false

local function bypassesMaintenance(userId: number): boolean
	return table.find(Config.MaintenanceBypassUserIds, userId) ~= nil
end

local function heartbeat(final: boolean?)
	local players = {}
	for _, p in Players:GetPlayers() do
		table.insert(players, tostring(p.UserId))
	end
	local res = Api.request("POST", "/v1/game/heartbeat", {
		jobId = Api.JobId,
		placeId = game.PlaceId,
		placeVersion = game.PlaceVersion,
		maxPlayers = Players.MaxPlayers,
		players = players,
		shuttingDown = final == true,
	})
	if res.ok and type(res.body) == "table" and type(res.body.settings) == "table" then
		local m = res.body.settings.maintenance
		if type(m) == "table" then
			maintenance.enabled = m.enabled == true
			maintenance.message = if type(m.message) == "string" then m.message else nil
		end
	end
end

Players.PlayerAdded:Connect(function(player)
	if maintenance.enabled and not bypassesMaintenance(player.UserId) then
		player:Kick(`Emden Network befindet sich in Wartung.{if maintenance.message then " " .. maintenance.message else ""}`)
		return
	end
	EventQueue.push("player.join", { robloxUserId = tostring(player.UserId) })
	task.spawn(Duty.loadProfile, player)
end)

Players.PlayerRemoving:Connect(function(player)
	EventQueue.push("player.leave", { robloxUserId = tostring(player.UserId) })
end)

-- Spieler, die vor dem Laden des Skripts beigetreten sind
for _, player in Players:GetPlayers() do
	EventQueue.push("player.join", { robloxUserId = tostring(player.UserId) })
	task.spawn(Duty.loadProfile, player)
end

-- Erst Heartbeat (Server registrieren), dann Schleifen starten.
heartbeat()

task.spawn(function()
	while not shuttingDown do
		task.wait(Config.HeartbeatSeconds)
		heartbeat()
	end
end)

task.spawn(function()
	while not shuttingDown do
		task.wait(Config.EventFlushSeconds)
		EventQueue.flush()
	end
end)

task.spawn(function()
	while not shuttingDown do
		task.wait(Config.ActionPollSeconds)
		Actions.poll()
	end
end)

game:BindToClose(function()
	shuttingDown = true
	-- Verbleibende Ereignisse senden und Server abmelden (BindToClose hat begrenzt Zeit).
	for _, player in Players:GetPlayers() do
		EventQueue.push("player.leave", { robloxUserId = tostring(player.UserId) })
	end
	for _ = 1, 3 do
		if EventQueue.size() == 0 then
			break
		end
		EventQueue.flush()
	end
	heartbeat(true)
end)
