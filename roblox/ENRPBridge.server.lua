--[[
	ENRPBridge v2 – Verbindung zwischen deinem Spiel und dem EN | POLIZEI-Discord-Bot über die Domain des Bots.

	Einbauen (ausführliche Anleitung: docs/live-system.md):
	  1. Roblox Studio → Game Settings → Security → "Allow HTTP Requests" einschalten.
	  2. ServerScriptService → Rechtsklick → Insert Object → Script (KEIN LocalScript), Name "ENRPBridge".
	  3. Diesen ganzen Text hineinkopieren und unten bei EINSTELLUNGEN BRIDGE_URL und BRIDGE_SECRET eintragen.
	  4. Spiel veröffentlichen.

	Das Skript …
	  - schickt alle 15 s den Live-Zustand (Spieler, Teams, Staff, Fahrzeuge, Wanted, Gefängnis) an den Bot
	  - schickt Ereignisse an den Bot: Beitritt/Verlassen, Kills, Notrufe, Mod-Calls, Befehle, Fahrzeuge, Teamwechsel
	  - holt alle 3 s Befehle aus Discord ab und bestätigt sie: Ansage, PM, Kick, Jail, Unjail, Heal, Kill, Respawn,
	    Wanted, Team, Neustart, Spielrechte
	  - prüft jeden Spieler beim Beitreten gegen die Bannliste des Bots (ganzes Spiel + Privatserver)
	  - setzt in Privatservern die Spielrechte; wer will, schaltet dort die Teamsperre ein (Extra-Funktion,
	    z. B. nur angenommene Bewerber ins Polizei-Team). Im Hauptspiel darf immer jeder in jedes Team.

	Sicherheit: Jede Anfrage ist mit HMAC-SHA256 signiert (Zeitstempel + Einmal-Nonce gegen Replay). Der Bridge-Schlüssel
	steht nur hier im Server-Skript – Server-Skripte werden nie an Spieler geschickt. Niemals in ein LocalScript oder
	nach ReplicatedStorage kopieren!

	Für eigene Skripte (z. B. dein Notruf-Handy oder Admin-System) gibt es in ServerStorage.ENRP:
	  Notruf:Fire(player, "Polizei", "Text")   ModCall:Fire(player, "Text")
	  Log:Fire(player, ":befehl …")             Kill:Fire(opfer, taeter, "Waffe")
	Attribute am Spieler: ENRP_Staff, ENRP_Wanted (0–5), ENRP_Jail (0 = frei), ENRP_<recht> (Privatserver), ENRP_Rechte
]]

-- ===================== EINSTELLUNGEN =====================

local BRIDGE_URL = "https://DEINE-DOMAIN.apps.bot-hosting.cloud" -- PUBLIC_URL des Bots, ohne / am Ende
local BRIDGE_SECRET = "HIER-DEN-BRIDGE-SCHLUESSEL-EINTRAGEN" -- aus /spiel-admin bridge-schluessel

-- Staff im Spiel: Roblox-Gruppe mit Mindest-Rängen und/oder einzelne Nutzer
local STAFF_GROUP_ID = 0 -- 0 = keine Gruppe
local STAFF_RANKS = { -- [Mindest-Rang in der Gruppe] = "Name des Staff-Rangs"
	-- [255] = "Projektleitung",
	-- [200] = "Admin",
	-- [100] = "Moderator",
}
local STAFF_USERS = { -- [Roblox-UserId] = "Name des Staff-Rangs"
	-- [123456789] = "Admin",
}

-- Fahrzeuge: Modelle mit diesem CollectionService-Tag werden erfasst. Dein Fahrzeug-Spawner sollte am Modell die
-- Attribute "Besitzer" (UserId), optional "Kennzeichen", "Farbe" und "Modell" setzen. Fehlt das Kennzeichen,
-- vergibt dieses Skript eins.
local VEHICLE_TAG = "ENRPFahrzeug"

-- Gefängnis: Teil im Workspace, zu dem gejailte Spieler teleportiert werden; optional ein Team für Gefangene
local JAIL_PART_NAME = "ENRPJail"
local JAIL_TEAM = nil -- z. B. "Gefangene"

-- Notrufe per Chat: Befehl → Bereich. Orte: Teile mit dem Tag LOCATION_TAG, der Name des Teils ist der Ortsname.
local CALL_COMMANDS = {
	["/notruf"] = "Polizei",
	["/110"] = "Polizei",
	["/112"] = "Rettungsdienst",
	["/feuerwehr"] = "Feuerwehr",
}
local MODCALL_COMMAND = "/modcall"
local LOCATION_TAG = "ENRPOrt"

-- Wanted-Sterne über dem Kopf anzeigen
local SHOW_WANTED_OVERHEAD = true

-- Teamsperre (Extra-Funktion, nur Privatserver): Teams, die ein Recht brauchen. Sie greift NUR in Privatservern,
-- deren Discord sie mit /einstellungen teamsperre aktiv:true eingeschaltet hat – sonst darf jeder in jedes Team, wie
-- im Hauptspiel. Die Rechte vergibt der Privatserver-Discord mit /einstellungen spielrecht.
-- Rechte-Namen wie in der config.json des Bots: polizei, sek, flugstaffel, ausbilder …
local TEAM_RIGHTS = {
	-- ["Polizei"] = "polizei",
	-- ["SEK"] = "sek",
}
local FALLBACK_TEAM = nil -- Team für alle ohne Recht (nil = neutral)
local OWNER_HAS_ALL_RIGHTS = true -- Besitzer darf in seinem Privatserver jedes Team wählen

-- =========================================================

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local CollectionService = game:GetService("CollectionService")
local TextService = game:GetService("TextService")
local TextChatService = game:GetService("TextChatService")
local ServerStorage = game:GetService("ServerStorage")
local Teams = game:GetService("Teams")

local PROTOCOL = 1
local BANNER_SECONDS = 15
local MAX_BUFFER = 300

-- BEGIN CRYPTO (SHA-256 und HMAC-SHA256, reines Luau mit bit32 – getestet gegen den Bot: scripts/test-lua-crypto.py)
local Crypto = {}
do
	local band, bor, bxor, bnot = bit32.band, bit32.bor, bit32.bxor, bit32.bnot
	local rrotate, rshift, lshift = bit32.rrotate, bit32.rshift, bit32.lshift
	local K = {
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
		0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
		0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
		0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
		0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
	}

	local function uint32ToBytes(n)
		return string.char(band(rshift(n, 24), 255), band(rshift(n, 16), 255), band(rshift(n, 8), 255), band(n, 255))
	end

	local function sha256(message)
		local length = #message
		local bitLength = length * 8
		local padded = message
			.. "\128"
			.. string.rep("\0", (55 - length) % 64)
			.. uint32ToBytes(math.floor(bitLength / 4294967296))
			.. uint32ToBytes(bitLength % 4294967296)
		local H = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 }
		local w = {}
		for chunk = 1, #padded, 64 do
			for j = 1, 16 do
				local a, b, c, d = string.byte(padded, chunk + (j - 1) * 4, chunk + (j - 1) * 4 + 3)
				w[j] = bor(lshift(a, 24), lshift(b, 16), lshift(c, 8), d)
			end
			for j = 17, 64 do
				local v15, v2 = w[j - 15], w[j - 2]
				local s0 = bxor(rrotate(v15, 7), rrotate(v15, 18), rshift(v15, 3))
				local s1 = bxor(rrotate(v2, 17), rrotate(v2, 19), rshift(v2, 10))
				w[j] = band(w[j - 16] + s0 + w[j - 7] + s1, 0xffffffff)
			end
			local a, b, c, d, e, f, g, h = H[1], H[2], H[3], H[4], H[5], H[6], H[7], H[8]
			for j = 1, 64 do
				local S1 = bxor(rrotate(e, 6), rrotate(e, 11), rrotate(e, 25))
				local ch = bxor(band(e, f), band(bnot(e), g))
				local temp1 = band(h + S1 + ch + K[j] + w[j], 0xffffffff)
				local S0 = bxor(rrotate(a, 2), rrotate(a, 13), rrotate(a, 22))
				local maj = bxor(band(a, b), band(a, c), band(b, c))
				local temp2 = band(S0 + maj, 0xffffffff)
				h = g
				g = f
				f = e
				e = band(d + temp1, 0xffffffff)
				d = c
				c = b
				b = a
				a = band(temp1 + temp2, 0xffffffff)
			end
			H[1] = band(H[1] + a, 0xffffffff)
			H[2] = band(H[2] + b, 0xffffffff)
			H[3] = band(H[3] + c, 0xffffffff)
			H[4] = band(H[4] + d, 0xffffffff)
			H[5] = band(H[5] + e, 0xffffffff)
			H[6] = band(H[6] + f, 0xffffffff)
			H[7] = band(H[7] + g, 0xffffffff)
			H[8] = band(H[8] + h, 0xffffffff)
		end
		local out = {}
		for i = 1, 8 do
			out[i] = uint32ToBytes(H[i])
		end
		return table.concat(out)
	end

	local function toHex(bytes)
		return (string.gsub(bytes, ".", function(char)
			return string.format("%02x", string.byte(char))
		end))
	end

	function Crypto.sha256Hex(message)
		return toHex(sha256(message))
	end

	function Crypto.hmacSha256Hex(key, message)
		if #key > 64 then
			key = sha256(key)
		end
		key = key .. string.rep("\0", 64 - #key)
		local inner, outer = {}, {}
		for i = 1, 64 do
			local byte = string.byte(key, i)
			inner[i] = string.char(bxor(byte, 0x36))
			outer[i] = string.char(bxor(byte, 0x5c))
		end
		return toHex(sha256(table.concat(outer) .. sha256(table.concat(inner) .. message)))
	end
end
-- END CRYPTO

-- ===================== Grundlagen =====================

local ownerId = game.PrivateServerOwnerId
local isPrivateServer = game.PrivateServerId ~= "" and ownerId ~= 0
local jobId = game.JobId ~= "" and game.JobId or ("studio-" .. HttpService:GenerateGUID(false))
local serverStartedAt = os.time()
local liveInterval, syncInterval = 15, 3
local configured = BRIDGE_URL:match("^https://") ~= nil
	and not BRIDGE_URL:find("DEINE%-DOMAIN")
	and #BRIDGE_SECRET >= 32
	and not BRIDGE_SECRET:find("HIER%-DEN")
local shuttingDown = false

if not configured then
	warn("[ENRPBridge] BRIDGE_URL und BRIDGE_SECRET sind nicht eingetragen – keine Verbindung zum Bot.")
end

local function log(message)
	warn("[ENRPBridge] " .. message)
end

-- Signierte Anfrage an die Bridge des Bots. Gibt ok, daten zurück.
local function bridgeRequest(method, path, bodyTable)
	if not configured then
		return false, "nicht eingerichtet"
	end
	local body = bodyTable and HttpService:JSONEncode(bodyTable) or ""
	local timestamp = tostring(os.time())
	local nonce = HttpService:GenerateGUID(false)
	local canonical = timestamp .. "\n" .. nonce .. "\n" .. method .. "\n" .. path .. "\n" .. body
	local headers = {
		["X-ENRP-Timestamp"] = timestamp,
		["X-ENRP-Nonce"] = nonce,
		["X-ENRP-Signature"] = Crypto.hmacSha256Hex(BRIDGE_SECRET, canonical),
	}
	local request = { Url = BRIDGE_URL .. path, Method = method, Headers = headers }
	if method ~= "GET" then
		headers["Content-Type"] = "application/json"
		request.Body = body
	end
	local ok, response = pcall(function()
		return HttpService:RequestAsync(request)
	end)
	if not ok then
		return false, tostring(response)
	end
	if not response.Success then
		return false, "HTTP " .. tostring(response.StatusCode)
	end
	local decoded, data = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	return true, decoded and data or nil
end

local ownerParam = tostring(isPrivateServer and ownerId or 0)

-- Text aus Discord durch den Roblox-Filter (Pflicht für Text, den Spieler sehen)
local function filterText(text, fromUserId)
	if text == nil or text == "" then
		return ""
	end
	local candidates = {}
	if tonumber(fromUserId) then
		table.insert(candidates, tonumber(fromUserId))
	end
	if isPrivateServer then
		table.insert(candidates, ownerId)
	end
	local anyPlayer = Players:GetPlayers()[1]
	if anyPlayer then
		table.insert(candidates, anyPlayer.UserId)
	end
	for _, userId in ipairs(candidates) do
		local ok, result = pcall(function()
			return TextService:FilterStringAsync(text, userId):GetNonChatStringForBroadcastAsync()
		end)
		if ok then
			return result
		end
	end
	return nil
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
	local limit = Instance.new("UISizeConstraint")
	limit.MinSize = Vector2.new(280, 0)
	limit.MaxSize = Vector2.new(640, math.huge)
	limit.Parent = frame
	Instance.new("UICorner", frame).CornerRadius = UDim.new(0, 10)
	local padding = Instance.new("UIPadding")
	for _, side in ipairs({ "PaddingTop", "PaddingBottom", "PaddingLeft", "PaddingRight" }) do
		padding[side] = UDim.new(0, 12)
	end
	padding.Parent = frame
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, 4)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = frame
	for index, entry in ipairs({ { title, 20, Color3.fromRGB(88, 101, 242), Enum.Font.GothamBold }, { text, 17, Color3.fromRGB(240, 240, 240), Enum.Font.Gotham } }) do
		local label = Instance.new("TextLabel")
		label.BackgroundTransparency = 1
		label.Size = UDim2.new(1, 0, 0, 0)
		label.AutomaticSize = Enum.AutomaticSize.Y
		label.TextWrapped = true
		label.TextXAlignment = Enum.TextXAlignment.Left
		label.Text = entry[1]
		label.TextSize = entry[2]
		label.TextColor3 = entry[3]
		label.Font = entry[4]
		label.LayoutOrder = index
		label.Parent = frame
	end
	gui.Parent = playerGui
	task.delay(BANNER_SECONDS, function()
		if gui.Parent then
			gui:Destroy()
		end
	end)
end

-- ===================== Ereignisse an den Bot =====================

local buffer = {}
local flushRequested = false

local function queueEvent(eventType, fields)
	local event = { v = PROTOCOL, id = HttpService:GenerateGUID(false), type = eventType, at = os.time(), job = jobId, owner = isPrivateServer and ownerId or 0 }
	for key, value in pairs(fields or {}) do
		event[key] = value
	end
	table.insert(buffer, event)
	if #buffer > MAX_BUFFER then
		table.remove(buffer, 1) -- Älteste verwerfen, wenn der Bot lange nicht erreichbar ist
	end
	if eventType == "ack" or eventType == "call" or eventType == "modcall" then
		flushRequested = true
	end
end

local function flushEvents()
	while #buffer > 0 do
		local batch = {}
		for i = 1, math.min(50, #buffer) do
			batch[i] = buffer[i]
		end
		local ok, err = bridgeRequest("POST", "/bridge/v1/events", { events = batch })
		if not ok then
			return false, err
		end
		for _ = 1, #batch do
			table.remove(buffer, 1)
		end
	end
	return true
end

local function playerFields(player)
	return { u = player.UserId, n = player.Name }
end

-- ===================== Staff, Wanted, Gefängnis =====================

local staffRank = {} -- [player] = "Rang"
local joinedAt = {}
local jailUntil = {} -- [player] = Unix-Zeit, -1 = bis Unjail

local function computeStaff(player)
	if STAFF_USERS[player.UserId] then
		return STAFF_USERS[player.UserId]
	end
	if STAFF_GROUP_ID ~= 0 then
		local ok, rank = pcall(function()
			return player:GetRankInGroup(STAFF_GROUP_ID)
		end)
		if ok and rank > 0 then
			local best, bestName = -1, nil
			for minimum, name in pairs(STAFF_RANKS) do
				if rank >= minimum and minimum > best then
					best, bestName = minimum, name
				end
			end
			if bestName then
				return bestName
			end
		end
	end
	if isPrivateServer and player.UserId == ownerId then
		return "Privatserver-Besitzer"
	end
	return nil
end

local function updateWantedOverhead(player)
	local character = player.Character
	local head = character and character:FindFirstChild("Head")
	if not head then
		return
	end
	local existing = head:FindFirstChild("ENRPWanted")
	local stars = player:GetAttribute("ENRP_Wanted") or 0
	if not SHOW_WANTED_OVERHEAD or stars <= 0 then
		if existing then
			existing:Destroy()
		end
		return
	end
	local gui = existing or Instance.new("BillboardGui")
	gui.Name = "ENRPWanted"
	gui.Size = UDim2.new(0, 120, 0, 30)
	gui.StudsOffset = Vector3.new(0, 2.5, 0)
	gui.AlwaysOnTop = true
	gui.MaxDistance = 120
	local label = gui:FindFirstChildOfClass("TextLabel") or Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 1, 0)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(255, 215, 0)
	label.TextStrokeTransparency = 0.3
	label.Text = string.rep("★", stars)
	label.Parent = gui
	gui.Parent = head
end

local function moveToJail(player)
	local part = workspace:FindFirstChild(JAIL_PART_NAME, true)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart")
	if part and part:IsA("BasePart") and root then
		character:PivotTo(part.CFrame + Vector3.new(0, 4, 0))
	end
	if JAIL_TEAM and Teams:FindFirstChild(JAIL_TEAM) then
		player.Team = Teams[JAIL_TEAM]
	end
end

local function release(player)
	jailUntil[player] = nil
	player:SetAttribute("ENRP_Jail", 0)
	if player.Parent then
		player:LoadCharacter()
	end
end

-- ===================== Spielrechte (nur Privatserver) =====================

local playerRights = {}
local rightsLoaded = {}
local teamLock = false -- vom Bot: hat der Privatserver-Discord die Teamsperre eingeschaltet?

local function hasRight(player, right)
	if OWNER_HAS_ALL_RIGHTS and player.UserId == ownerId then
		return true
	end
	local rights = playerRights[player]
	return rights ~= nil and rights[right] == true
end

local function setRights(player, list)
	local rights, names = {}, {}
	for _, right in ipairs(type(list) == "table" and list or {}) do
		if type(right) == "string" and right:match("^[%l%d_]+$") and not rights[right] then
			rights[right] = true
			table.insert(names, right)
		end
	end
	table.sort(names)
	for right in pairs(playerRights[player] or {}) do
		if not rights[right] then
			player:SetAttribute("ENRP_" .. right, nil)
		end
	end
	for _, right in ipairs(names) do
		player:SetAttribute("ENRP_" .. right, true)
	end
	player:SetAttribute("ENRP_Rechte", table.concat(names, ","))
	playerRights[player] = rights
	return names
end

local function enforceTeam(player)
	if not isPrivateServer or not teamLock or not rightsLoaded[player] or player.Parent == nil then
		return
	end
	local team = player.Team
	local needed = team and TEAM_RIGHTS[team.Name]
	if not needed or hasRight(player, needed) then
		return
	end
	local fallback = FALLBACK_TEAM and Teams:FindFirstChild(FALLBACK_TEAM) or nil
	player.Team = fallback
	player.Neutral = fallback == nil
	showBanner(player, "🔒 " .. team.Name, "Für dieses Team brauchst du eine angenommene Bewerbung im Discord dieses Privatservers.")
	task.defer(function()
		if player.Parent then
			player:LoadCharacter()
		end
	end)
end

-- Teamsperre an/aus (kommt bei jedem Abruf vom Bot); beim Einschalten sofort alle prüfen
local function setTeamLock(enabled)
	enabled = isPrivateServer and enabled == true
	if enabled == teamLock then
		return
	end
	teamLock = enabled
	log("Teamsperre " .. (enabled and "eingeschaltet" or "ausgeschaltet"))
	if enabled then
		for _, player in ipairs(Players:GetPlayers()) do
			enforceTeam(player)
		end
	end
end

-- ===================== Banns =====================

local bans = {} -- [UserId-String] = { r = Grund, e = Ablauf (0 = dauerhaft), s = "g"/"p" }
local bansVersion = nil

local function banMessage(ban)
	local untilText = (ban.e or 0) == 0 and "dauerhaft"
		or ("bis " .. DateTime.fromUnixTimestamp(ban.e):FormatUniversalTime("DD.MM.YYYY HH:mm", "de-de") .. " UTC")
	return "Du bist gebannt (" .. untilText .. "). Grund: " .. (filterText(tostring(ban.r or ""), nil) or "—")
end

local function checkBan(player)
	local ban = bans[tostring(player.UserId)]
	if ban and ((ban.e or 0) == 0 or ban.e > os.time()) then
		if not (isPrivateServer and ban.s == "p" and player.UserId == ownerId) then
			player:Kick(banMessage(ban))
			return true
		end
	end
	return false
end

local function refreshBans()
	local ok, data = bridgeRequest("GET", "/bridge/v1/bans?owner=" .. ownerParam)
	if ok and type(data) == "table" and type(data.bans) == "table" then
		bans = data.bans
		bansVersion = data.version
		for _, player in ipairs(Players:GetPlayers()) do
			checkBan(player)
		end
	end
end

-- ===================== Befehle aus Discord =====================

local function ack(cmd, ok, message)
	if cmd then
		queueEvent("ack", { cmd = cmd, ok = ok, msg = message })
	end
end

local function targetPlayer(cmd)
	local player = Players:GetPlayerByUserId(tonumber(cmd.userId) or 0)
	if not player then
		ack(cmd.cmd, false, "Spieler ist nicht (mehr) auf diesem Server.")
	end
	return player
end

local function humanoidOf(player)
	local character = player.Character
	return character and character:FindFirstChildOfClass("Humanoid")
end

local handlers = {}

function handlers.announce(cmd)
	local text = filterText(tostring(cmd.text or ""), cmd.by)
	if not text or text == "" then
		return ack(cmd.cmd, false, "Text vom Roblox-Filter blockiert.")
	end
	for _, player in ipairs(Players:GetPlayers()) do
		showBanner(player, "📢 Ansage", text)
	end
	ack(cmd.cmd, true, "Angezeigt für " .. #Players:GetPlayers() .. " Spieler.")
end

function handlers.pm(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	local text = filterText(tostring(cmd.text or ""), cmd.by)
	if not text or text == "" then
		return ack(cmd.cmd, false, "Text vom Roblox-Filter blockiert.")
	end
	showBanner(player, "✉️ Nachricht vom Team", text)
	ack(cmd.cmd, true, "Nachricht zugestellt.")
end

function handlers.kick(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	player:Kick("Du wurdest vom Team gekickt. Grund: " .. (filterText(tostring(cmd.reason or ""), cmd.by) or "—"))
	ack(cmd.cmd, true, "Gekickt.")
end

function handlers.jail(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	local minutes = tonumber(cmd.minutes) or 10
	jailUntil[player] = minutes > 0 and (os.time() + minutes * 60) or -1
	player:SetAttribute("ENRP_Jail", jailUntil[player])
	moveToJail(player)
	showBanner(player, "🔒 Gefängnis", (minutes > 0 and (minutes .. " Minuten") or "Bis zur Freilassung") .. ". Grund: " .. (filterText(tostring(cmd.reason or ""), cmd.by) or "—"))
	ack(cmd.cmd, true, minutes > 0 and ("Für " .. minutes .. " Minuten im Gefängnis.") or "Im Gefängnis bis Unjail.")
end

function handlers.unjail(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	if not jailUntil[player] then
		return ack(cmd.cmd, false, "Spieler ist nicht im Gefängnis.")
	end
	release(player)
	ack(cmd.cmd, true, "Freigelassen.")
end

function handlers.heal(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	local humanoid = humanoidOf(player)
	if not humanoid then
		return ack(cmd.cmd, false, "Spieler hat gerade keinen Charakter.")
	end
	humanoid.Health = humanoid.MaxHealth
	ack(cmd.cmd, true, "Geheilt.")
end

function handlers.kill(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	local humanoid = humanoidOf(player)
	if not humanoid then
		return ack(cmd.cmd, false, "Spieler hat gerade keinen Charakter.")
	end
	humanoid.Health = 0
	ack(cmd.cmd, true, "Getötet.")
end

function handlers.respawn(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	player:LoadCharacter()
	ack(cmd.cmd, true, "Neu gespawnt.")
end

function handlers.wanted(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	local stars = math.clamp(tonumber(cmd.stars) or 0, 0, 5)
	player:SetAttribute("ENRP_Wanted", stars)
	updateWantedOverhead(player)
	ack(cmd.cmd, true, stars > 0 and ("Fahndungsstufe " .. stars .. " ★") or "Fahndung aufgehoben.")
end

function handlers.team(cmd)
	local player = targetPlayer(cmd)
	if not player then
		return
	end
	local team = Teams:FindFirstChild(tostring(cmd.team or ""))
	if not team or not team:IsA("Team") then
		return ack(cmd.cmd, false, "Team gibt es nicht.")
	end
	player.Team = team
	player:LoadCharacter()
	ack(cmd.cmd, true, "Team: " .. team.Name)
end

function handlers.shutdown(cmd)
	shuttingDown = true
	local reason = filterText(tostring(cmd.reason or ""), cmd.by) or "Neustart"
	ack(cmd.cmd, true, "Server wird geleert.")
	flushEvents()
	for _, player in ipairs(Players:GetPlayers()) do
		player:Kick("Der Server startet neu: " .. reason .. ". Du kannst sofort wieder beitreten.")
	end
end

function handlers.rights(cmd)
	if not isPrivateServer then
		return
	end
	local player = Players:GetPlayerByUserId(tonumber(cmd.userId) or 0)
	if not player then
		return
	end
	local names = setRights(player, cmd.rights)
	rightsLoaded[player] = true
	showBanner(player, "🔑 Rechte aktualisiert", #names > 0 and ("Du darfst jetzt: " .. table.concat(names, ", ")) or "Du hast keine besonderen Rechte mehr.")
	enforceTeam(player)
	ack(cmd.cmd, true, "Rechte gesetzt.")
end

function handlers.refresh()
	refreshBans()
end

local syncState = { cursor = -1, boot = "" }

local function sync()
	local path = "/bridge/v1/sync?job=" .. jobId .. "&owner=" .. ownerParam .. "&cursor=" .. tostring(syncState.cursor) .. "&boot=" .. syncState.boot
	local ok, data = bridgeRequest("GET", path)
	if not ok or type(data) ~= "table" then
		return false
	end
	syncState.cursor = tonumber(data.cursor) or syncState.cursor
	syncState.boot = tostring(data.boot or "")
	if type(data.config) == "table" then
		liveInterval = math.clamp(tonumber(data.config.live) or liveInterval, 10, 60)
		syncInterval = math.clamp(tonumber(data.config.sync) or syncInterval, 2, 30)
	end
	if data.teamLock ~= nil then
		setTeamLock(data.teamLock)
	end
	if data.bansVersion ~= nil and data.bansVersion ~= bansVersion then
		task.spawn(refreshBans)
	end
	for _, cmd in ipairs(type(data.commands) == "table" and data.commands or {}) do
		local handler = handlers[cmd.action]
		if handler then
			local success, err = pcall(handler, cmd)
			if not success then
				log("Fehler bei " .. tostring(cmd.action) .. ": " .. tostring(err))
				ack(cmd.cmd, false, "Fehler im Spiel-Skript.")
			end
		else
			ack(cmd.cmd, false, "Unbekannter Befehl – Spiel-Skript aktualisieren.")
		end
	end
	return true
end

-- ===================== Live-Zustand =====================

local function colorHex(color)
	return string.format("#%02x%02x%02x", math.floor(color.R * 255), math.floor(color.G * 255), math.floor(color.B * 255))
end

local function vehicleInfo(model)
	local owner = tonumber(model:GetAttribute("Besitzer")) or 0
	local ownerPlayer = owner ~= 0 and Players:GetPlayerByUserId(owner) or nil
	local part = model:IsA("Model") and (model.PrimaryPart or model:FindFirstChildWhichIsA("BasePart", true)) or nil
	local colorName = model:GetAttribute("Farbe")
	if colorName == nil and part then
		colorName = part.BrickColor.Name
	end
	return {
		m = tostring(model:GetAttribute("Modell") or model.Name),
		o = owner,
		on = ownerPlayer and ownerPlayer.Name or model:GetAttribute("BesitzerName"),
		p = model:GetAttribute("Kennzeichen"),
		c = colorName and tostring(colorName) or nil,
		h = part and colorHex(part.Color) or nil,
	}
end

local function snapshot()
	local players, vehicles, teamNames = {}, {}, {}
	for _, player in ipairs(Players:GetPlayers()) do
		table.insert(players, {
			id = player.UserId,
			n = player.Name,
			d = player.DisplayName,
			t = player.Team and player.Team.Name or nil,
			s = staffRank[player],
			w = player:GetAttribute("ENRP_Wanted") or 0,
			j = jailUntil[player] or 0,
			c = player:GetAttribute("ENRP_Callsign") or player:GetAttribute("Callsign"),
			since = joinedAt[player],
		})
	end
	for _, model in ipairs(CollectionService:GetTagged(VEHICLE_TAG)) do
		if model:IsDescendantOf(workspace) and #vehicles < 250 then
			table.insert(vehicles, vehicleInfo(model))
		end
	end
	for _, team in ipairs(Teams:GetTeams()) do
		table.insert(teamNames, team.Name)
	end
	return {
		v = PROTOCOL,
		job = jobId,
		owner = isPrivateServer and ownerId or 0,
		ps = isPrivateServer,
		max = Players.MaxPlayers,
		started = serverStartedAt,
		at = os.time(),
		ver = game.PlaceVersion,
		teams = teamNames,
		players = players,
		vehicles = vehicles,
	}
end

-- ===================== Spieler =====================

local lastTeam = {}

local function loadPlayer(player)
	local ok, data = bridgeRequest("GET", "/bridge/v1/player?id=" .. player.UserId .. "&owner=" .. ownerParam)
	if player.Parent == nil then
		return
	end
	if ok and type(data) == "table" then
		if type(data.ban) == "table" then
			bans[tostring(player.UserId)] = data.ban
		end
		if checkBan(player) then
			return
		end
		if isPrivateServer then
			setRights(player, data.rights)
			if data.teamLock ~= nil then
				setTeamLock(data.teamLock)
			end
		end
	else
		checkBan(player) -- Bot nicht erreichbar: zuletzt bekannte Bannliste
	end
	rightsLoaded[player] = true
	enforceTeam(player)
end

local function watchCharacter(player, character)
	local humanoid = character:WaitForChild("Humanoid", 10)
	if jailUntil[player] then
		task.defer(moveToJail, player)
	end
	task.defer(updateWantedOverhead, player)
	if not humanoid then
		return
	end
	humanoid.Died:Connect(function()
		local creator = humanoid:FindFirstChild("creator")
		local killer = creator and creator.Value
		local weapon = nil
		if typeof(killer) ~= "Instance" or not killer:IsA("Player") then
			local id = character:GetAttribute("ENRP_LastDamager")
			killer = id and Players:GetPlayerByUserId(id) or nil
		end
		if killer and killer.Character then
			local tool = killer.Character:FindFirstChildOfClass("Tool")
			weapon = tool and tool.Name or nil
		end
		queueEvent("kill", {
			vu = player.UserId,
			vn = player.Name,
			ku = killer and killer.UserId or nil,
			kn = killer and killer.Name or nil,
			w = weapon,
		})
	end)
end

local function onPlayerAdded(player)
	if shuttingDown then
		player:Kick("Der Server startet gerade neu. Bitte tritt erneut bei.")
		return
	end
	joinedAt[player] = os.time()
	if checkBan(player) then
		return
	end
	staffRank[player] = computeStaff(player)
	player:SetAttribute("ENRP_Staff", staffRank[player])
	player:SetAttribute("ENRP_Wanted", player:GetAttribute("ENRP_Wanted") or 0)
	player:SetAttribute("ENRP_Jail", 0)
	lastTeam[player] = player.Team and player.Team.Name or nil
	player:GetPropertyChangedSignal("Team"):Connect(function()
		local now = player.Team and player.Team.Name or nil
		if now ~= lastTeam[player] then
			queueEvent("team", { u = player.UserId, n = player.Name, from = lastTeam[player], to = now })
			lastTeam[player] = now
		end
		enforceTeam(player)
	end)
	player.CharacterAdded:Connect(function(character)
		watchCharacter(player, character)
	end)
	if player.Character then
		task.spawn(watchCharacter, player, player.Character)
	end
	local fields = playerFields(player)
	fields.s = staffRank[player]
	queueEvent("join", fields)
	task.spawn(loadPlayer, player)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	local fields = playerFields(player)
	fields.dur = os.time() - (joinedAt[player] or os.time())
	fields.s = staffRank[player]
	queueEvent("leave", fields)
	staffRank[player], joinedAt[player], jailUntil[player] = nil, nil, nil
	playerRights[player], rightsLoaded[player], lastTeam[player] = nil, nil, nil
end)

-- ===================== Fahrzeuge =====================

local function onVehicleAdded(model)
	task.delay(1, function() -- Spawner Zeit geben, die Attribute zu setzen
		if not model:IsDescendantOf(workspace) then
			return
		end
		if not model:GetAttribute("Kennzeichen") then
			model:SetAttribute("Kennzeichen", string.format("EN-%s%04d", string.char(64 + math.random(1, 26)), math.random(0, 9999)))
		end
		local info = vehicleInfo(model)
		local owner = Players:GetPlayerByUserId(info.o)
		queueEvent("vehicle", { act = "spawn", u = owner and owner.UserId or nil, n = owner and owner.Name or nil, m = info.m, p = info.p, c = info.c })
	end)
end

CollectionService:GetInstanceAddedSignal(VEHICLE_TAG):Connect(onVehicleAdded)
CollectionService:GetInstanceRemovedSignal(VEHICLE_TAG):Connect(function(model)
	local owner = Players:GetPlayerByUserId(tonumber(model:GetAttribute("Besitzer")) or 0)
	queueEvent("vehicle", { act = "despawn", u = owner and owner.UserId or nil, n = owner and owner.Name or nil, m = tostring(model:GetAttribute("Modell") or model.Name), p = model:GetAttribute("Kennzeichen") })
end)
for _, model in ipairs(CollectionService:GetTagged(VEHICLE_TAG)) do
	if not model:GetAttribute("Kennzeichen") then
		onVehicleAdded(model)
	end
end

-- ===================== Notrufe und Mod-Calls =====================

local callNumber = 0
local lastCall, lastModcall = {}, {}

local function nearestLocation(position)
	local best, bestDistance = nil, 300
	for _, part in ipairs(CollectionService:GetTagged(LOCATION_TAG)) do
		if part:IsA("BasePart") then
			local distance = (part.Position - position).Magnitude
			if distance < bestDistance then
				best, bestDistance = part:GetAttribute("Name") or part.Name, distance
			end
		end
	end
	return best
end

local function emergencyCall(player, team, text)
	if typeof(player) ~= "Instance" or not player:IsA("Player") then
		return
	end
	if lastCall[player.UserId] and os.time() - lastCall[player.UserId] < 60 then
		return showBanner(player, "⏳ Notruf", "Bitte warte eine Minute bis zum nächsten Notruf.")
	end
	text = tostring(text or ""):sub(1, 400)
	if text == "" then
		return showBanner(player, "🚨 Notruf", "Beschreibe den Notfall, z. B. /notruf Überfall an der Tankstelle")
	end
	lastCall[player.UserId] = os.time()
	callNumber = callNumber + 1
	local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	local fields = playerFields(player)
	fields.num = callNumber
	fields.team = tostring(team or "Polizei")
	fields.text = text
	fields.loc = root and nearestLocation(root.Position) or nil
	fields.x = root and math.floor(root.Position.X) or nil
	fields.z = root and math.floor(root.Position.Z) or nil
	queueEvent("call", fields)
	showBanner(player, "🚨 Notruf #" .. callNumber .. " abgesetzt", "Bereich: " .. fields.team .. ". Bleib in der Nähe, Hilfe ist unterwegs.")
end

local function modCall(player, text)
	if typeof(player) ~= "Instance" or not player:IsA("Player") then
		return
	end
	if lastModcall[player.UserId] and os.time() - lastModcall[player.UserId] < 120 then
		return showBanner(player, "⏳ Mod-Call", "Bitte warte zwei Minuten bis zum nächsten Mod-Call.")
	end
	lastModcall[player.UserId] = os.time()
	local fields = playerFields(player)
	fields.text = tostring(text or ""):sub(1, 300)
	queueEvent("modcall", fields)
	showBanner(player, "🆘 Mod-Call gesendet", "Das Team wurde benachrichtigt.")
end

local function handleChat(player, message)
	local command, rest = string.match(message, "^(%S+)%s*(.*)$")
	command = command and string.lower(command)
	if command and CALL_COMMANDS[command] then
		emergencyCall(player, CALL_COMMANDS[command], rest)
	elseif command == MODCALL_COMMAND then
		modCall(player, rest)
	end
end

if TextChatService.ChatVersion == Enum.ChatVersion.TextChatService then
	local aliases = {}
	for alias in pairs(CALL_COMMANDS) do
		table.insert(aliases, alias)
	end
	table.insert(aliases, MODCALL_COMMAND)
	for _, alias in ipairs(aliases) do
		local command = Instance.new("TextChatCommand")
		command.Name = "ENRP" .. alias:gsub("%W", "")
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
	Players.PlayerAdded:Connect(function(player)
		player.Chatted:Connect(function(message)
			handleChat(player, message)
		end)
	end)
end

-- Schnittstelle für eigene Skripte: ServerStorage.ENRP
local api = Instance.new("Folder")
api.Name = "ENRP"
local function bindable(name, callback)
	local event = Instance.new("BindableEvent")
	event.Name = name
	event.Event:Connect(callback)
	event.Parent = api
end
bindable("Notruf", function(player, team, text)
	emergencyCall(player, team, text)
end)
bindable("ModCall", function(player, text)
	modCall(player, text)
end)
bindable("Log", function(player, text)
	if typeof(player) == "Instance" and player:IsA("Player") then
		local fields = playerFields(player)
		fields.text = tostring(text or ""):sub(1, 300)
		fields.src = "admin"
		queueEvent("command", fields)
	end
end)
bindable("Kill", function(victim, killer, weapon)
	if typeof(victim) == "Instance" and victim:IsA("Player") then
		local hasKiller = typeof(killer) == "Instance" and killer:IsA("Player")
		queueEvent("kill", {
			vu = victim.UserId,
			vn = victim.Name,
			ku = hasKiller and killer.UserId or nil,
			kn = hasKiller and killer.Name or nil,
			w = weapon and tostring(weapon) or nil,
		})
	end
end)
api.Parent = ServerStorage

-- ===================== Schleifen =====================

if configured then
	task.spawn(refreshBans)

	-- Befehle abholen
	task.spawn(function()
		local failures = 0
		while not shuttingDown do
			if sync() then
				failures = 0
			else
				failures = failures + 1
			end
			task.wait(math.min(syncInterval * (failures + 1), 30))
		end
	end)

	-- Live-Zustand
	task.spawn(function()
		while not shuttingDown do
			local ok, err = bridgeRequest("POST", "/bridge/v1/live", snapshot())
			if not ok then
				log("Live-Daten nicht gesendet: " .. tostring(err))
			end
			task.wait(liveInterval)
		end
	end)

	-- Ereignisse (sofort bei Notruf, Mod-Call und Bestätigung, sonst alle 2 s; bei Fehlern langsamer)
	task.spawn(function()
		local backoff = 2
		while true do
			local waited = 0
			while waited < backoff and not flushRequested do
				task.wait(0.25)
				waited = waited + 0.25
			end
			flushRequested = false
			if #buffer > 0 then
				local ok = flushEvents()
				backoff = ok and 2 or math.min(backoff * 2, 30)
			end
		end
	end)

	-- Gefängnis-Zeit prüfen
	task.spawn(function()
		while true do
			task.wait(5)
			for player, untilTime in pairs(jailUntil) do
				if untilTime > 0 and os.time() >= untilTime and player.Parent then
					release(player)
				end
			end
		end
	end)
end

game:BindToClose(function()
	if not configured then
		return
	end
	for _, player in ipairs(Players:GetPlayers()) do
		local fields = playerFields(player)
		fields.dur = os.time() - (joinedAt[player] or os.time())
		fields.s = staffRank[player]
		queueEvent("leave", fields)
	end
	flushEvents()
	bridgeRequest("POST", "/bridge/v1/bye", { job = jobId })
end)
