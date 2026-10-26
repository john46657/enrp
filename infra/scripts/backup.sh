#!/bin/sh
# Erstellt ein komprimiertes Backup (pg_dump, custom format) und löscht Backups älter als RETENTION_DAYS.
# Aufruf z. B. per Cron: 15 3 * * * /opt/emden-network/infra/scripts/backup.sh
set -eu
BACKUP_DIR="${BACKUP_DIR:-/var/backups/emden-network}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE="${COMPOSE:-docker compose}"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/emden-$(date -u +%Y%m%dT%H%M%SZ).dump"
$COMPOSE exec -T postgres pg_dump -U emden_owner -d emden --format=custom --no-owner > "$FILE.partial"
mv "$FILE.partial" "$FILE"
find "$BACKUP_DIR" -name 'emden-*.dump' -mtime +"$RETENTION_DAYS" -delete
echo "Backup erstellt: $FILE"
