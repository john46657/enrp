--!strict
-- HTTP-Client für die Emden-Network-API. Nur serverseitig verwendbar.
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local Config = require(script.Parent.Config)

local Api = {}

-- In Studio ist game.JobId leer; dann eine eindeutige Test-ID verwenden.
Api.JobId = if game.JobId ~= "" then game.JobId else ("studio-" .. HttpService:GenerateGUID(false))

local cachedSecret: Secret? = nil

local function authHeader(): Secret
	if cachedSecret == nil then
		local ok, result = pcall(function()
			return HttpService:GetSecret(Config.SecretName)
		end)
		if not ok then
			error(`[EmdenNetwork] Secret "{Config.SecretName}" nicht verfügbar – im Creator Hub anlegen.`)
		end
		cachedSecret = (result :: Secret):AddPrefix("Bearer ")
	end
	return cachedSecret :: Secret
end

export type Response = { ok: boolean, status: number, body: any }

--[[
	Führt eine Anfrage aus. Netzwerkfehler und 5xx/429 werden mit Backoff wiederholt,
	4xx nicht (fachliche Ablehnung). Wirft nie, sondern liefert ok=false.
]]
function Api.request(method: string, path: string, body: any?): Response
	if not RunService:IsServer() then
		error("[EmdenNetwork] Api darf nur auf dem Server verwendet werden")
	end
	local attempt = 0
	while true do
		attempt += 1
		local ok, res = pcall(function()
			return HttpService:RequestAsync({
				Url = Config.ApiBaseUrl .. path,
				Method = method,
				Headers = {
					["Content-Type"] = "application/json",
					["Authorization"] = authHeader(),
					["Roblox-Job-Id"] = Api.JobId,
				},
				Body = if body ~= nil then HttpService:JSONEncode(body) else nil,
			})
		end)
		if ok then
			local status = res.StatusCode
			local decoded = nil
			if res.Body and #res.Body > 0 then
				local okDecode, value = pcall(HttpService.JSONDecode, HttpService, res.Body)
				decoded = if okDecode then value else nil
			end
			if res.Success then
				return { ok = true, status = status, body = decoded }
			end
			if status < 500 and status ~= 429 then
				warn(`[EmdenNetwork] {method} {path} abgelehnt: {status}`)
				return { ok = false, status = status, body = decoded }
			end
		else
			warn(`[EmdenNetwork] {method} {path} Netzwerkfehler: {tostring(res)}`)
		end
		if attempt >= Config.RequestTimeoutRetries then
			return { ok = false, status = 0, body = nil }
		end
		task.wait(2 ^ attempt)
	end
end

function Api.nowIso(): string
	return DateTime.now():ToIsoDate()
end

return Api
