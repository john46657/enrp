#!/bin/sh
# Legt die eingeschränkte Anwendungsrolle an (läuft nur bei der Erstinitialisierung des Volumes).
# emden_owner: besitzt das Schema, führt Migrationen aus.
# emden_app:   nur DML (SELECT/INSERT/UPDATE/DELETE), kein DDL – für API und Bot.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE emden_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO emden_app;
GRANT USAGE ON SCHEMA public TO emden_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO emden_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO emden_app;
SQL
