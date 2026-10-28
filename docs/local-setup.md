# Lokale Einrichtung

## Voraussetzungen

- **Node.js 22.12+** und npm (`node -v`, `npm -v`). Empfehlung: über [nvm](https://github.com/nvm-sh/nvm),
  dann genügt `nvm use` (liest `.nvmrc`).
- Git.
- Ab Phase 2 zusätzlich: PostgreSQL 16+ (lokal oder per Docker).

## Einrichten

```bash
git clone <repository-url> emden-network
cd emden-network
npm install
cp .env.example .env
```

`npm install` baut dabei automatisch `packages/shared`.
**Nach Änderungen in `packages/shared/src`** einmal `npm run build -w @emden/shared` ausführen, damit
Backend und Dashboard die neue Version sehen (Tests nutzen immer direkt den Quellcode).

## Starten (Entwicklung)

Zwei Terminals:

```bash
npm run dev:api         # Backend, startet bei Codeänderungen neu
npm run dev:dashboard   # Dashboard
```

- Backend: <http://127.0.0.1:4000/health> und <http://127.0.0.1:4000/ready>
- Dashboard: <http://localhost:3000> – die Übersicht zeigt „Backend erreichbar“. Stoppst du das Backend,
  erscheint nach einem Neuladen „Backend nicht erreichbar“.

## Starten (Produktions-Build lokal)

```bash
npm run build
NODE_ENV=production npm run start:api
npm run start:dashboard
```

## Häufige Probleme

| Meldung                                    | Lösung                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `Ungültige Konfiguration: API_PORT …`      | Wert in `.env` prüfen; die Meldung nennt die Variable.              |
| `EADDRINUSE`                               | Port belegt – anderen `API_PORT` wählen oder alten Prozess beenden. |
| Dashboard zeigt „Backend nicht erreichbar“ | Läuft `npm run dev:api`? Stimmt `API_INTERNAL_URL`?                 |
| `Cannot find module '@emden/shared'`       | `npm install` bzw. `npm run build -w @emden/shared` ausführen.      |
