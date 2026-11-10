--[[
	ENRPBridge – Verbindung zwischen dem ENRP-Discord-Bot und diesem Spiel.

	Einbauen (Anleitung mit Bildern-Beschreibung: docs/roblox.md):
	  1. Roblox Studio → ServerScriptService → Rechtsklick → Insert Object → Script (kein LocalScript)
	  2. Script "ENRPBridge" nennen und diesen ganzen Text hineinkopieren.
	  3. Spiel veröffentlichen. Fertig – laufende Server bekommen das Skript nach einem Neustart.

	Was das Skript macht:
	  - Ansagen aus Discord (/spiel ansage) als Banner anzeigen
	  - Kicks und Server-Neustarts aus Discord ausführen
	  - Banns von Privatserver-Discords durchsetzen (gelten nur in den Privatservern dieses Besitzers)
	Banns für das ganze Spiel macht Roblox selbst über die Ban-API, dafür braucht es hier nichts.

	Der Bot schickt Nachrichten über MessagingService. Nur Server dieses Spiels und der Bot mit dem
	API-Key können auf das Thema senden – Spieler können keine Befehle vortäuschen.
]]

local MessagingService = game:GetService("MessagingService")
local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local TextService = game:GetService("TextService")

-- Muss zu src/lib/roblox/openCloud.js passen
local TOPIC = "ENRPBot"
local PRIVATE_BANS_STORE = "ENRPPrivatServerBans"
local BANNER_SECONDS = 15

-- Privatserver (VIP-Server) haben einen Besitzer. Reservierte Server haben zwar eine PrivateServerId, aber keinen Besitzer.
local ownerId = game.PrivateServerOwnerId
local isPrivateServer = game.PrivateServerId ~= "" and ownerId ~= 0
local privateBans = DataStoreService:GetDataStore(PRIVATE_BANS_STORE)
local shuttingDown = false

local function isForThisServer(target)
	if target == "all" then
		return true
	end
	return isPrivateServer and target == "owner:" .. tostring(ownerId)
end

-- Text aus Discord muss wie jeder Spielertext durch den Roblox-Filter. Gefiltert wird im Namen des Absenders
-- (verifiziertes Roblox-Konto), sonst des Privatserver-Besitzers oder eines Spielers auf dem Server.
local function filterText(text, fromUserId)
	if text == "" then
		return ""
	end
	local candidates = { tonumber(fromUserId) }
	if isPrivateServer then
		table.insert(candidates, ownerId)
	end
	local anyPlayer = Players:GetPlayers()[1]
	if anyPlayer then
		table.insert(candidates, anyPlayer.UserId)
	end
	local lastError
	for _, userId in ipairs(candidates) do
		local ok, result = pcall(function()
			return TextService:FilterStringAsync(text, userId):GetNonChatStringForBroadcastAsync()
		end)
		if ok then
			return result
		end
		lastError = result
	end
	warn("[ENRPBridge] Textfilter fehlgeschlagen: " .. tostring(lastError))
	return nil
end

local function makeLabel(parent, text, size, color, bold)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 0, 0)
	label.AutomaticSize = Enum.AutomaticSize.Y
	label.TextWrapped = true
	label.RichText = false
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Font = bold and Enum.Font.GothamBold or Enum.Font.Gotham
	label.TextSize = size
	label.TextColor3 = color
	label.Text = text
	label.Parent = parent
	return label
end

local function showBanner(player, title, text)
	local playerGui = player:FindFirstChildOfClass("PlayerGui")
	if not playerGui then
		return
	end
	local old = playerGui:FindFirstChild("ENRPBanner")
	if old then
		old:Destroy()
	end

	local gui = Instance.new("ScreenGui")
	gui.Name = "ENRPBanner"
	gui.ResetOnSpawn = false
	gui.DisplayOrder = 100

	local frame = Instance.new("Frame")
	frame.AnchorPoint = Vector2.new(0.5, 0)
	frame.Position = UDim2.new(0.5, 0, 0, 16)
	frame.Size = UDim2.new(0.5, 0, 0, 0)
	frame.AutomaticSize = Enum.AutomaticSize.Y
	frame.BackgroundColor3 = Color3.fromRGB(30, 31, 34)
	frame.BackgroundTransparency = 0.1
	frame.Parent = gui

	local sizeLimit = Instance.new("UISizeConstraint")
	sizeLimit.MinSize = Vector2.new(280, 0)
	sizeLimit.MaxSize = Vector2.new(640, math.huge)
	sizeLimit.Parent = frame

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 10)
	corner.Parent = frame

	local padding = Instance.new("UIPadding")
	for _, side in ipairs({ "PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight" }) do
		padding[side] = UDim.new(0, 12)
	end
	padding.Parent = frame

	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 4)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = frame

	makeLabel(frame, title, 20, Color3.fromRGB(88, 101, 242), true).LayoutOrder = 1
	makeLabel(frame, text, 17, Color3.fromRGB(240, 240, 240), false).LayoutOrder = 2

	gui.Parent = playerGui
	task.delay(BANNER_SECONDS, function()
		if gui.Parent then
			gui:Destroy()
		end
	end)
end

-- Banns der Privatserver dieses Besitzers, 30 Sekunden zwischengespeichert
local banCache = { loaded = false, at = 0, data = {} }

local function getPrivateBans()
	if banCache.loaded and os.clock() - banCache.at < 30 then
		return banCache.data
	end
	local ok, result = pcall(function()
		return privateBans:GetAsync(tostring(ownerId))
	end)
	if ok then
		banCache = { loaded = true, at = os.clock(), data = type(result) == "table" and result or {} }
	else
		warn("[ENRPBridge] Privatserver-Banns konnten nicht geladen werden: " .. tostring(result))
	end
	return banCache.data
end

local function checkPrivateBan(player)
	if not isPrivateServer or player.UserId == ownerId then
		return
	end
	local ban = getPrivateBans()[tostring(player.UserId)]
	if type(ban) ~= "table" then
		return
	end
	local expires = tonumber(ban.expires) or 0
	if expires == 0 or expires > os.time() then
		local untilText = expires == 0 and "dauerhaft" or ("bis " .. os.date("!%d.%m.%Y %H:%M", expires) .. " UTC")
		player:Kick("Du bist von diesem Privatserver gebannt (" .. untilText .. "). Grund: " .. (filterText(tostring(ban.reason or ""), ownerId) or "—"))
	end
end

local function kickPlayer(msg, prefix)
	local player = Players:GetPlayerByUserId(tonumber(msg.userId) or 0)
	if not player then
		return
	end
	-- Ein Privatserver-Discord kann den Besitzer nicht aus seinem eigenen Server werfen
	if msg.target ~= "all" and player.UserId == ownerId then
		return
	end
	local reason = filterText(tostring(msg.reason or ""), msg.by) or "—"
	player:Kick(prefix .. " Grund: " .. reason)
end

local handlers = {}

function handlers.announce(msg)
	local text = filterText(tostring(msg.text or ""), msg.by)
	if not text or text == "" then
		return
	end
	for _, player in ipairs(Players:GetPlayers()) do
		showBanner(player, "📢 Ansage", text)
	end
end

function handlers.kick(msg)
	kickPlayer(msg, "Du wurdest vom Team gekickt.")
end

function handlers.ban(msg)
	banCache.loaded = false
	kickPlayer(msg, "Du wurdest von diesem Server gebannt.")
end

function handlers.refresh()
	banCache.loaded = false
end

function handlers.shutdown(msg)
	shuttingDown = true
	local reason = filterText(tostring(msg.reason or ""), msg.by) or "Neustart"
	for _, player in ipairs(Players:GetPlayers()) do
		player:Kick("Der Server startet neu: " .. reason .. ". Du kannst sofort wieder beitreten.")
	end
end

local function onMessage(message)
	local ok, msg = pcall(function()
		return HttpService:JSONDecode(message.Data)
	end)
	if not ok or type(msg) ~= "table" or msg.v ~= 1 or not isForThisServer(msg.target) then
		return
	end
	local handler = handlers[msg.action]
	if handler then
		local success, err = pcall(handler, msg)
		if not success then
			warn("[ENRPBridge] Fehler bei " .. tostring(msg.action) .. ": " .. tostring(err))
		end
	end
end

Players.PlayerAdded:Connect(function(player)
	if shuttingDown then
		player:Kick("Der Server startet gerade neu. Bitte tritt erneut bei.")
		return
	end
	checkPrivateBan(player)
end)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(checkPrivateBan, player)
end

task.spawn(function()
	for attempt = 1, 5 do
		local ok, err = pcall(function()
			MessagingService:SubscribeAsync(TOPIC, onMessage)
		end)
		if ok then
			return
		end
		warn(("[ENRPBridge] Verbindung zum Bot fehlgeschlagen (%d/5): %s"):format(attempt, tostring(err)))
		task.wait(5 * attempt)
	end
end)
