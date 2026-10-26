--!strict
-- Zeigt Ankündigungen von Emden Network an. Enthält keine Geheimnisse und sendet nichts an den Server.
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remote = ReplicatedStorage:WaitForChild("EmdenNetworkAnnouncement") :: RemoteEvent
local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")

local gui = Instance.new("ScreenGui")
gui.Name = "EmdenNetworkAnnouncements"
gui.ResetOnSpawn = false
gui.Parent = playerGui

local frame = Instance.new("Frame")
frame.AnchorPoint = Vector2.new(0.5, 0)
frame.Position = UDim2.new(0.5, 0, 0, 24)
frame.Size = UDim2.new(0.5, 0, 0, 72)
frame.BackgroundColor3 = Color3.fromRGB(20, 24, 33)
frame.BackgroundTransparency = 0.1
frame.Visible = false
frame.Parent = gui
Instance.new("UICorner", frame).CornerRadius = UDim.new(0, 10)

local label = Instance.new("TextLabel")
label.BackgroundTransparency = 1
label.Size = UDim2.new(1, -24, 1, -12)
label.Position = UDim2.new(0, 12, 0, 6)
label.TextColor3 = Color3.new(1, 1, 1)
label.TextWrapped = true
label.TextScaled = true
label.Font = Enum.Font.GothamMedium
label.Parent = frame

local token = 0
remote.OnClientEvent:Connect(function(title: string, text: string)
	token += 1
	local mine = token
	-- Text ist serverseitig gefiltert; als reiner Text darstellen (kein RichText).
	label.RichText = false
	label.Text = `{title}: {text}`
	frame.Visible = true
	task.delay(10, function()
		if mine == token then
			frame.Visible = false
		end
	end)
end)
