-- Team-Befehle im Spiel-Chat: :jail, :unjail, :wanted, :heal, :kill, :respawn, :team, :pm, :kick, :cmds
-- Das Spiel entscheidet NICHT selbst, wer das darf: Jeder Befehl geht an die Plattform, die das Roblox-Konto über
-- die Discord-Verknüpfung (/verify) einer Person zuordnet und deren Rechte prüft (wie im Dashboard, mit Audit-Log).
-- Erlaubte Befehle führt der Server sofort aus.
-- Bewusst in einfacher Syntax geschrieben (gültiges Luau und Lua 5.1).
local Players = game:GetService("Players")
local TextChatService = game:GetService("TextChatService")

local Api = require(script.Parent.Api)
local Config = require(script.Parent.Config)

local StaffCommands = {}

local announce = nil
local runCommand = nil -- führt einen Server-Befehl aus und bestätigt ihn (aus Main)
local lastUse = {}

local HELP = ":jail Name Minuten [Grund] · :unjail Name · :wanted Name Stufe · :heal Name · :kill Name · "
	.. ":respawn Name · :team Name Team · :pm Name Text · :kick Name [Grund]"

-- Befehl → welche Werte nach dem Spielernamen kommen
local COMMANDS = {
	jail = "minutes",
	unjail = "reason",
	wanted = "level",
	heal = "reason",
	kill = "reason",
	respawn = "reason",
	team = "team",
	pm = "message",
	kick = "reason",
}

local function notify(player, text)
	if announce then
		announce:FireClient(player, "🛠️ Team-Befehl", text)
	end
end

-- Spieler über Namen, Anzeigenamen oder Namensanfang finden (muss eindeutig sein)
local function findTarget(text)
	local wanted = string.lower(text or "")
	if wanted == "" then
		return nil, "Spielername fehlt."
	end
	local matches = {}
	for _, player in ipairs(Players:GetPlayers()) do
		local name = string.lower(player.Name)
		local display = string.lower(player.DisplayName)
		if name == wanted or display == wanted then
			return player
		end
		if string.sub(name, 1, #wanted) == wanted or string.sub(display, 1, #wanted) == wanted then
			table.insert(matches, player)
		end
	end
	if #matches == 1 then
		return matches[1]
	end
	if #matches == 0 then
		return nil, "Kein Spieler „" .. text .. "“ auf diesem Server."
	end
	return nil, "Mehrere Spieler passen zu „" .. text .. "“ – bitte genauer."
end

local function split(text)
	local words = {}
	for word in string.gmatch(text, "%S+") do
		table.insert(words, word)
	end
	return words
end

local function handle(player, message)
	local words = split(message)
	local command = words[1] and string.lower(string.sub(words[1], 2)) or ""
	if command == "cmds" or command == "hilfe" then
		notify(player, HELP)
		return
	end
	local kind = COMMANDS[command]
	if not kind then
		return
	end
	local now = os.clock()
	if lastUse[player.UserId] and now - lastUse[player.UserId] < 1 then
		return
	end
	lastUse[player.UserId] = now
	local target, problem = findTarget(words[2])
	if not target then
		notify(player, problem)
		return
	end
	local rest = table.concat(words, " ", 3)
	local body = {
		jobId = Api.jobId(),
		issuerId = player.UserId,
		targetId = target.UserId,
		targetName = target.Name,
		action = command,
	}
	if kind == "minutes" then
		body.minutes = tonumber(words[3])
		body.reason = table.concat(words, " ", 4)
		if not body.minutes then
			notify(player, "Dauer in Minuten fehlt, z. B. :jail " .. target.Name .. " 5 Überfall")
			return
		end
	elseif kind == "level" then
		body.level = tonumber(words[3])
		body.reason = table.concat(words, " ", 4)
		if not body.level then
			notify(player, "Fahndungsstufe 0–5 fehlt.")
			return
		end
	elseif kind == "team" then
		body.team = words[3]
		body.reason = table.concat(words, " ", 4)
		if not body.team then
			notify(player, "Team fehlt.")
			return
		end
	elseif kind == "message" then
		body.message = string.sub(rest, 1, 300)
		if body.message == "" then
			notify(player, "Nachricht fehlt.")
			return
		end
	else
		body.reason = rest
	end
	if body.reason == "" then
		body.reason = nil
	end
	local response = Api.request("POST", "/api/v1/game/staff-commands", body)
	if not response.ok or not response.body then
		notify(player, "Plattform nicht erreichbar – bitte später erneut.")
		return
	end
	if not response.body.ok then
		notify(player, tostring(response.body.error or "Abgelehnt."))
		return
	end
	if runCommand and response.body.command then
		runCommand(response.body.command)
	end
	notify(player, "Erledigt: :" .. command .. " " .. target.Name)
end

function StaffCommands.init(announceEvent, applyCommand)
	announce = announceEvent
	runCommand = applyCommand
	local prefix = Config.StaffCommandPrefix or ":"
	local function onMessage(player, message)
		if string.sub(message, 1, #prefix) == prefix then
			task.spawn(handle, player, ":" .. string.sub(message, #prefix + 1))
		end
	end
	if TextChatService.ChatVersion == Enum.ChatVersion.TextChatService then
		local names = { "cmds", "hilfe" }
		for name in pairs(COMMANDS) do
			table.insert(names, name)
		end
		for _, name in ipairs(names) do
			local command = Instance.new("TextChatCommand")
			command.Name = "ENRPTeam" .. name
			command.PrimaryAlias = prefix .. name
			command.Triggered:Connect(function(textSource, message)
				local player = Players:GetPlayerByUserId(textSource.UserId)
				if player then
					onMessage(player, message)
				end
			end)
			command.Parent = TextChatService
		end
	else
		local function hook(player)
			player.Chatted:Connect(function(message)
				onMessage(player, message)
			end)
		end
		Players.PlayerAdded:Connect(hook)
		for _, player in ipairs(Players:GetPlayers()) do
			hook(player)
		end
	end
	Players.PlayerRemoving:Connect(function(player)
		lastUse[player.UserId] = nil
	end)
end

return StaffCommands
