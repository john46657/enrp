# Legacy: bestehender ENRP-Discord-Bot

Dieser Ordner enthält den Discord-Bot, der vor dem Start von **Emden Network** im Repository lag
(Tickets, Bewerbungen, Moderation, Community). Er wurde mit `git mv` unverändert hierher verschoben –
die Git-Historie bleibt erhalten, es wurde nichts gelöscht.

Er ist **kein** Teil der npm Workspaces und hat weiterhin eigene Abhängigkeiten und eine eigene `.env`.

```bash
npm run legacy:bot:install   # einmalig: Abhängigkeiten installieren
cp legacy/discord-bot/.env.example legacy/discord-bot/.env   # Token eintragen
npm run legacy:bot:start
```

> Läuft der Bot bereits bei einem Hoster mit dem Startbefehl `node index.js` im Repository-Wurzelordner,
> muss dort nach dem Zusammenführen dieses Branches das Arbeitsverzeichnis auf `legacy/discord-bot`
> umgestellt werden.

Ob und wie Funktionen daraus in den neuen Bot (`apps/bot`, Phase 4) übernommen werden, wird in Phase 4
entschieden. Hinweis: Das Bewerbungs-/Einheitensystem entspricht einem Personalsystem und gehört laut
Projektauftrag **nicht** zum Umfang von Emden Network.
