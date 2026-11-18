--!strict
-- Client: zeigt Ankündigungen und Wartungshinweise an. Enthält keine Geheimnisse und trifft keine Entscheidungen.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remotes = ReplicatedStorage:WaitForChild("ENRP")
local player = Players.LocalPlayer

local gui = Instance.new("ScreenGui")
gui.Name = "ENRP"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local function makeBanner(name: string, color: Color3, y: number): TextLabel
	local label = Instance.new("TextLabel")
	label.Name = name
	label.Size = UDim2.new(0.6, 0, 0, 56)
	label.Position = UDim2.new(0.2, 0, 0, y)
	label.BackgroundColor3 = color
	label.BackgroundTransparency = 0.1
	label.TextColor3 = Color3.new(1, 1, 1)
	label.TextWrapped = true
	label.Font = Enum.Font.GothamMedium
	label.TextSize = 16
	label.Visible = false
	label.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = label
	return label
end

local announcement = makeBanner("Announcement", Color3.fromRGB(20, 31, 53), 12)
local maintenance = makeBanner("Maintenance", Color3.fromRGB(150, 95, 10), 76)

remotes:WaitForChild("Announcement").OnClientEvent:Connect(function(title: string, body: string)
	announcement.Text = ("%s\n%s"):format(title, string.sub(body, 1, 200))
	announcement.Visible = true
	task.delay(15, function()
		announcement.Visible = false
	end)
end)

remotes:WaitForChild("Maintenance").OnClientEvent:Connect(function(message: string?)
	maintenance.Visible = message ~= nil
	maintenance.Text = message or ""
end)
