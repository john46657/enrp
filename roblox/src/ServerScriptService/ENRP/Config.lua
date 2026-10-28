--!strict
-- Konfiguration der ENRP-Integration. Enthält KEINE Geheimnisse:
-- Der API-Schlüssel liegt ausschließlich im Roblox Secrets Store (Creator Hub → Spiel → Secrets).
local Config = {
	-- Öffentliche HTTPS-Adresse der API (ohne abschließenden Schrägstrich).
	ApiBaseUrl = "https://dashboard.example.de",
	-- Name des Secrets im Secrets Store. Wert: der im Dashboard erzeugte Schlüssel (enrp_rbx_…).
	-- Für den Domain-Filter des Secrets die Domain der API eintragen.
	SecretName = "ENRP_API_KEY",

	HeartbeatIntervalSeconds = 30,
	EventFlushIntervalSeconds = 5,
	MaxEventsPerBatch = 20,
	MaxQueuedEvents = 500,
	RequestTimeoutRetries = 3,

	-- Fraktionen mit Dienstsystem (Schlüssel wie im Backend).
	DutyFactions = { polizei = true, feuerwehr = true, rettungsdienst = true },
	-- Mindestabstand zwischen Dienst-Umschaltungen pro Spieler (Schutz gegen Spam).
	DutyToggleCooldownSeconds = 10,
	-- Mindestabstand zwischen Code-Einlösungen pro Spieler.
	RedeemCooldownSeconds = 10,

	-- Zugang verweigern, wenn das Backend beim Betreten nicht erreichbar ist?
	-- false = Spieler dürfen spielen; Bann-Prüfung wird beim nächsten Heartbeat nachgeholt.
	DenyJoinWhenBackendDown = false,
}

return Config
