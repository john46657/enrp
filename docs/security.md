# Sicherheit

## Authentifizierung

| Zugang | Verfahren |
|---|---|
| Dashboard | Discord-OAuth (Code-Flow, PKCE, state, Browser-Bindungs-Cookie). Sitzungstoken (256 Bit) nur als SHA-256 gespeichert; Cookie `httpOnly`, `SameSite=Lax`, `Secure` (außer lokal). 12 h Inaktivität, max. 7 Tage. Zugang nur mit mindestens einem Recht. |
| Schreibzugriffe im Browser | Origin-Prüfung + Synchronizer-CSRF-Token (`X-CSRF-Token`) |
| Discord-Bot | Service-Token (Vergleich in konstanter Zeit) + handelnde Person; Fehlversuche werden protokolliert |
| Roblox-Spielserver | API-Schlüssel (nur Hash gespeichert, widerrufbar, optional auf Place-IDs beschränkt) + Zeitstempel ±5 Min. + einmalige Nonce (Replay → 409 + kritisches Sicherheitsereignis) |
| CI/CD-Rückmeldung | gemeinsames Geheimnis `RELEASE_WEBHOOK_SECRET` |
| `/metrics` | Bearer `METRICS_TOKEN`, sonst 404 |

## Autorisierung

Jede geschützte Operation prüft serverseitig in `packages/core`. Nicht angemeldete Anfragen sind ein eigener
Akteurtyp ohne Rechte. Rechteausweitung ist verhindert (siehe [permissions.md](permissions.md)); kritische
Aktionen brauchen eine zweite Person; Selbstaktionen (eigener Einspruch, eigene Freigabe, eigenes Release,
Selbstsanktion) sind ausgeschlossen.

## Eingaben und Ausgaben

- Strikte Zod-Validierung aller Requests, Längen- und Mengenbegrenzungen, Request-Größe (Standard 256 KB).
- SQL ausschließlich über Drizzle (parametrisiert); dynamische Bezeichner nur aus festen Listen.
- React escapt Ausgaben; HTML-Ergebnisseiten der API escapen alle Werte und senden `default-src 'none'`.
- Sicherheitsheader über Helmet (API) und Next (CSP, `frame-ancestors 'none'`, `nosniff`, Referrer-Policy).
- Einheitliches Fehlerformat mit Request-ID; Stacktraces und interne Meldungen werden nur geloggt.
- Discord-Nachrichten des Systems verhindern Massen-Erwähnungen (`allowed_mentions` leer).
- Links in Fallberichten nur `https://`, im Dashboard mit `rel="noopener noreferrer nofollow"`.

## Rate-Limits und Missbrauchsschutz

Global 300 Anfragen/Min. je IP bzw. je handelnder Person (Redis-gestützt), strengere Grenzen für Login,
Verifizierung (max. 5 Starts/Stunde), Tickets/Reports, SSE-Verbindungen (3 je Person, 200 gesamt);
Roblox 600/Min. je Schlüssel. Fachliche Grenzen: 3 offene Tickets, 5 Reports/Stunde, 3 Vorschläge/Tag.

## Geheimnisse und Logs

- Keine Geheimnisse im Repository oder Frontend; `.env.example` ohne Werte. Umgebungsvalidierung nennt nur
  Variablennamen.
- Pino-Logs schwärzen Authorization-, Cookie-, Token- und Secret-Felder.
- OAuth-Tokens werden nach dem Profilabruf sofort widerrufen und nie gespeichert.
- IP-Adressen werden nur als HMAC gespeichert.

## Audit-Log

Append-only (Trigger blockiert UPDATE/DELETE/TRUNCATE außer in markierten Aufbewahrungs-Transaktionen),
SHA-256-Hash-Kette über kanonisches JSON, prüfbar mit `/audit verify`. **Empfehlung Produktion:** Die
Anwendung mit einer Datenbankrolle ohne `TRUNCATE`/`UPDATE` auf `audit_events` betreiben und die
Aufbewahrungsbereinigung mit einer separaten Rolle ausführen; der Trigger allein schützt nicht gegen einen
Datenbank-Superuser.

## Kill-Switch und Feature-Flags

Der Kill-Switch sperrt schreibende Aktionen in Bot/API und Spielereignisse (außer Betreten/Verlassen).
Flags schalten nur Funktionen ab; Authentifizierung und Rechteprüfung lassen sich damit nicht umgehen.

## Bekannte Grenzen

- Next.js benötigt `'unsafe-inline'` für Skripte (Hydration); Nonce-basierte CSP wäre ein möglicher nächster Schritt.
- Roblox-Anfragen sind nicht signiert (siehe [roblox/README.md](../roblox/README.md)); Schutz durch TLS, geheimen
  Schlüssel, Zeitfenster und Nonce.
- Befehls-Overrides wirken im Bot; das Dashboard nutzt ausschließlich die Rollenrechte.
