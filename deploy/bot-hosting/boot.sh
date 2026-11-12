#!/usr/bin/env bash
# Startbefehl für bot-hosting.net (Panel → Deployment → Start command):
#   bash deploy/bot-hosting/boot.sh
# Installiert Abhängigkeiten und baut nur, wenn sich der Code geändert hat; startet dann den Supervisor.
set -euo pipefail
cd "$(dirname "$0")/../.."

PNPM_VERSION=10.28.0
if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  corepack enable --install-directory "$HOME/.local/bin" pnpm >/dev/null 2>&1 || true
  export PATH="$HOME/.local/bin:$PATH"
  PNPM=(corepack "pnpm@$PNPM_VERSION")
else
  PNPM=(npx --yes "pnpm@$PNPM_VERSION")
fi

export NEXT_TELEMETRY_DISABLED=1 CI=true
STAMP_FILE=".enrp-build-stamp"
STAMP="$(git rev-parse HEAD 2>/dev/null || date +%s)-$(sha1sum pnpm-lock.yaml | cut -c1-12)"

if [ "${ENRP_FORCE_BUILD:-false}" = "true" ] || [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$STAMP" ]; then
  echo "[enrp] Installiere Abhängigkeiten und baue (Stand $STAMP) …"
  "${PNPM[@]}" install --frozen-lockfile
  # Next.js-Build braucht Arbeitsspeicher; auf kleinen Plänen begrenzen.
  NODE_OPTIONS="${ENRP_BUILD_NODE_OPTIONS:---max-old-space-size=1536}" "${PNPM[@]}" build
  # Statische Dateien neben den Standalone-Server des Dashboards legen.
  rm -rf apps/dashboard/.next/standalone/apps/dashboard/.next/static
  cp -r apps/dashboard/.next/static apps/dashboard/.next/standalone/apps/dashboard/.next/static
  echo "$STAMP" > "$STAMP_FILE"
else
  echo "[enrp] Build ist aktuell ($STAMP) – überspringe Installation."
fi

mkdir -p data/backups
exec node deploy/bot-hosting/start.mjs
