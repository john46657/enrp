--!strict
-- Ingame-Ankündigungen: Text wird vor der Anzeige über den Roblox-Textfilter geleitet.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TextService = game:GetService("TextService")

local Announcements = {}

-- Nur Server -> Client. Eingehende Client-Nachrichten werden ignoriert.
local remote = Instance.new("RemoteEvent")
remote.Name = "EmdenNetworkAnnouncement"
remote.Parent = ReplicatedStorage
remote.OnServerEvent:Connect(function() end)

local function filterForBroadcast(text: string): string?
	-- Absender für den Filter: Ersteller der Experience bzw. erster Spieler auf dem Server.
	local fromUserId = if game.CreatorType == Enum.CreatorType.User then game.CreatorId else nil
	if fromUserId == nil then
		local first = Players:GetPlayers()[1]
		fromUserId = if first then first.UserId else nil
	end
	if fromUserId == nil then
		return nil
	end
	local ok, result = pcall(function()
		local filtered = TextService:FilterStringAsync(text, fromUserId, Enum.TextFilterContext.PublicChat)
		return filtered:GetNonChatStringForBroadcastAsync()
	end)
	if not ok then
		warn(`[EmdenNetwork] Textfilter fehlgeschlagen: {tostring(result)}`)
		return nil
	end
	return result
end

-- Liefert true, wenn die Ankündigung angezeigt wurde.
function Announcements.broadcast(title: string, text: string): boolean
	if #Players:GetPlayers() == 0 then
		return true -- niemand online, gilt als zugestellt
	end
	local filtered = filterForBroadcast(string.sub(text, 1, 200))
	if filtered == nil then
		return false
	end
	remote:FireAllClients(title, filtered)
	return true
end

return Announcements
