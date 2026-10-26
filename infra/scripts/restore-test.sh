#!/bin/sh
# Prüft ein Backup, indem es in eine TEMPORÄRE Datenbank wiederhergestellt wird.
# Die Produktionsdatenbank wird dabei nicht verändert.
set -eu
FILE="${1:?Pfad zur .dump-Datei angeben}"
COMPOSE="${COMPOSE:-docker compose}"
DB="emden_restore_test_$(date +%s)"
$COMPOSE exec -T postgres createdb -U emden_owner "$DB"
trap '$COMPOSE exec -T postgres dropdb -U emden_owner "$DB"' EXIT
$COMPOSE exec -T postgres pg_restore -U emden_owner -d "$DB" --no-owner --exit-on-error < "$FILE"
$COMPOSE exec -T postgres psql -U emden_owner -d "$DB" -v ON_ERROR_STOP=1 -c \
  "SELECT (SELECT count(*) FROM schema_migrations) AS migrationen, (SELECT count(*) FROM users) AS nutzer, (SELECT count(*) FROM discord_links WHERE revoked_at IS NULL) AS verknuepfungen;"
echo "Wiederherstellung erfolgreich getestet ($DB wird entfernt)."
