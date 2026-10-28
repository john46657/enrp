--!strict
-- Authentifizierter HTTP-Client für die ENRP-API. Läuft ausschließlich auf dem Server.
-- Jede Anfrage trägt: Bearer-Schlüssel (aus dem Secrets Store), Zeitstempel und Nonce (Replay-Schutz).
local HttpService = game:GetService("HttpService")
local Config = require(script.Parent.Config)

local Api = {}

export type Response = {
	ok: boolean,
	status: number,
	body: any?,
	errorCode: string?,
	message: string?,
}

local secret: any? = nil
local function authorization(): any?
	if secret == nil then
		local ok, result = pcall(function()
			return HttpService:GetSecret(Config.SecretName)
		end)
		if not ok then
			warn("[ENRP] Secret '" .. Config.SecretName .. "' fehlt oder ist nicht für diese Domain freigegeben.")
			return nil
		end
		secret = result:AddPrefix("Bearer ")
	end
	return secret
end

-- Einfaches Budget, damit das Roblox-Limit für HttpService (Anfragen pro Minute) nicht erreicht wird.
local budget = { windowStart = os.clock(), used = 0, limit = 300 }
local function takeBudget(): boolean
	local now = os.clock()
	if now - budget.windowStart >= 60 then
		budget.windowStart = now
		budget.used = 0
	end
	if budget.used >= budget.limit then
		return false
	end
	budget.used += 1
	return true
end

function Api.newId(): string
	return HttpService:GenerateGUID(false)
end

-- Führt eine Anfrage aus. Wiederholt bei Netzwerkfehlern, 429 und 5xx mit exponentiellem Backoff.
-- idempotencyKey sorgt dafür, dass Wiederholungen keine doppelten Wirkungen haben.
function Api.request(method: string, path: string, body: any?, idempotencyKey: string?): Response
	local auth = authorization()
	if auth == nil then
		return { ok = false, status = 0, errorCode = "NOT_CONFIGURED", message = "API-Schlüssel fehlt" }
	end
	local encoded = if body ~= nil then HttpService:JSONEncode(body) else nil
	local attempt = 0
	while true do
		attempt += 1
		if not takeBudget() then
			return { ok = false, status = 0, errorCode = "LOCAL_RATE_LIMIT", message = "HTTP-Budget erschöpft" }
		end
		local headers: { [string]: any } = {
			["Authorization"] = auth,
			["Content-Type"] = "application/json",
			["X-Roblox-Timestamp"] = tostring(os.time()),
			["X-Roblox-Nonce"] = HttpService:GenerateGUID(false),
			["X-Roblox-Place-Id"] = tostring(game.PlaceId),
		}
		if idempotencyKey then
			headers["Idempotency-Key"] = idempotencyKey
		end
		local ok, result = pcall(function()
			return HttpService:RequestAsync({
				Url = Config.ApiBaseUrl .. path,
				Method = method,
				Headers = headers,
				Body = encoded,
			})
		end)
		if ok then
			local decoded = nil
			if result.Body and #result.Body > 0 then
				local parsed, value = pcall(function()
					return HttpService:JSONDecode(result.Body)
				end)
				if parsed then
					decoded = value
				end
			end
			local status = result.StatusCode
			local retryable = status == 429 or status >= 500
			if result.Success then
				return { ok = true, status = status, body = decoded }
			end
			if not retryable or attempt >= Config.RequestTimeoutRetries then
				local err = decoded and decoded.error
				return { ok = false, status = status, body = decoded, errorCode = err and err.code, message = err and err.message }
			end
		elseif attempt >= Config.RequestTimeoutRetries then
			return { ok = false, status = 0, errorCode = "NETWORK_ERROR", message = tostring(result) }
		end
		task.wait(math.min(2 ^ attempt, 10))
	end
end

return Api
