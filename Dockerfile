# syntax=docker/dockerfile:1.7
# Ein Dockerfile für alle Dienste: docker build --target api|worker|bot|dashboard .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/bot/package.json apps/bot/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/integrations/package.json packages/integrations/
COPY packages/permissions/package.json packages/permissions/
COPY packages/shared/package.json packages/shared/
COPY tests/package.json tests/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG APP_VERSION=0.0.0-dev
RUN pnpm --filter @enrp/api --filter @enrp/worker --filter @enrp/bot build \
 && pnpm --filter @enrp/dashboard build
# Produktionsabhängigkeiten je Dienst isolieren (ohne Dev-Abhängigkeiten).
RUN pnpm --filter @enrp/api deploy --legacy --prod /out/api \
 && pnpm --filter @enrp/worker deploy --legacy --prod /out/worker \
 && pnpm --filter @enrp/bot deploy --legacy --prod /out/bot

FROM node:22-alpine AS runtime
RUN apk add --no-cache tini && addgroup -S enrp && adduser -S enrp -G enrp
ENV NODE_ENV=production
WORKDIR /app
ENTRYPOINT ["/sbin/tini", "--"]

FROM runtime AS api
COPY --from=build --chown=enrp:enrp /out/api ./
COPY --from=build --chown=enrp:enrp /repo/packages/database/drizzle ./drizzle
ENV MIGRATIONS_DIR=/app/drizzle API_PORT=4000
USER enrp
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "dist/main.js"]

FROM runtime AS worker
# pg_dump/pg_restore für Backups (Version passend zum Datenbankserver).
RUN apk add --no-cache postgresql16-client
COPY --from=build --chown=enrp:enrp /out/worker ./
RUN mkdir -p /backups && chown enrp:enrp /backups
ENV BACKUP_DIR=/backups
USER enrp
CMD ["node", "dist/main.js"]

FROM runtime AS bot
COPY --from=build --chown=enrp:enrp /out/bot ./
# Laufzeitdaten der Altmodule (Bewerbungen, Level, Ticketpanel) liegen in legacy/data → Volume.
RUN mkdir -p legacy/data && chown -R enrp:enrp legacy/data
USER enrp
CMD ["node", "dist/main.js"]

FROM runtime AS dashboard
COPY --from=build --chown=enrp:enrp /repo/apps/dashboard/.next/standalone ./
COPY --from=build --chown=enrp:enrp /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
ENV PORT=3000 HOSTNAME=0.0.0.0
USER enrp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "apps/dashboard/server.js"]
