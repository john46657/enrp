# Emden Network – ein Image für API, Bot und Migrationen (Befehl bestimmt die Rolle).
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.build.json ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
RUN pnpm build && pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/packages packages
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json /app/apps/api/
COPY --from=build --chown=node:node /app/apps/api/node_modules apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/bot/dist apps/bot/dist
COPY --from=build --chown=node:node /app/apps/bot/package.json /app/apps/bot/
COPY --from=build --chown=node:node /app/apps/bot/node_modules apps/bot/node_modules
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
