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
	-- Abstand für das Abholen von Server-Befehlen (Nachricht, Herunterfahren) zwischen zwei Heartbeats.
	CommandPollIntervalSeconds = 5,
	-- Thema für den Open-Cloud-Weckruf (muss zum Backend passen).
	CommandWakeTopic = "ENRP_Commands",
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

	-- Leitstelle: Chat-Befehle für Notrufe (Befehl → Bereich, muss im Dashboard unter Leitstelle existieren).
	CallCommands = { ["/notruf"] = "Polizei", ["/110"] = "Polizei", ["/112"] = "Rettungsdienst", ["/feuerwehr"] = "Feuerwehr" },
	ModCallCommand = "/modcall",
	CallCooldownSeconds = 60,
	ModCallCooldownSeconds = 120,
	-- CollectionService-Tag für Fahrzeug-Modelle (Live-Lage, Kennzeichen-Suche, Fahrzeug-Protokoll).
	VehicleTag = "ENRPFahrzeug",
	-- CollectionService-Tag für Orts-Parts (Attribut „Name“), der nächste Ort wird beim Notruf mitgeschickt.
	LocationTag = "ENRPOrt",
	LocationMaxDistance = 300,

	-- Ingame-Aktionen: CollectionService-Tag für Gefängnis-Parts (Spawnpunkte im Gefängnis).
	JailTag = "ENRPGefaengnis",
	-- Optional: Team für Gefangene (nil = Team bleibt). Beim Entlassen zurück ins vorherige Team,
	-- sonst in ReleaseTeam (nil = ohne Team).
	JailTeam = nil :: string?,
	ReleaseTeam = nil :: string?,
}

return Config
