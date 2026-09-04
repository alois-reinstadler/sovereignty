# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/sync-protocol/package.json packages/sync-protocol/package.json
COPY packages/vault-core/package.json packages/vault-core/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm --filter @svrgn/web build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/sync-protocol/package.json packages/sync-protocol/package.json
COPY packages/vault-core/package.json packages/vault-core/package.json
RUN pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/apps/web/migrations ./apps/web/migrations
COPY --from=build --chown=node:node /app/apps/web/scripts ./apps/web/scripts
COPY --from=build --chown=node:node /app/apps/web/src/lib/server-env.ts ./apps/web/src/lib/server-env.ts

USER node
EXPOSE 3000
CMD ["node", "apps/web/scripts/start.mjs"]
