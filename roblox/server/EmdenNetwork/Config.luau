--!strict
-- Emden Network – Konfiguration der Spielintegration.
-- Liegt in ServerScriptService und wird NICHT zum Client repliziert.
-- Enthält bewusst keine Geheimnisse: der API-Schlüssel kommt aus den Experience-Secrets
-- (Creator Hub → Experience → Secrets), abgerufen über HttpService:GetSecret.

local Config = {
	-- Öffentliche HTTPS-Basis-URL der Emden-Network-API (ohne abschließenden Schrägstrich)
	ApiBaseUrl = "https://api.example.invalid",

	-- Name des Secrets im Creator Hub, Inhalt = GAME_API_KEY der API
	SecretName = "EmdenNetworkGameApiKey",

	HeartbeatSeconds = 30,
	ActionPollSeconds = 5,
	EventFlushSeconds = 5,
	MaxQueuedEvents = 500,
	RequestTimeoutRetries = 3,

	-- Roblox-User-IDs, die trotz Wartungsmodus beitreten dürfen (z. B. Entwickler)
	MaintenanceBypassUserIds = {} :: { number },

	-- Fraktionen, für die im Spiel Dienst begonnen werden kann (muss zur API passen)
	DutyFactions = { polizei = true, feuerwehr = true, rettungsdienst = true },
}

return Config
