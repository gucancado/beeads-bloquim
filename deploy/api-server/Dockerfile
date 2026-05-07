# syntax=docker/dockerfile:1.7

# ---- builder ----
FROM node:24-alpine AS builder

# python3 / make / g++ are needed by some native deps (bcrypt, helmet's transitive native modules)
RUN apk add --no-cache python3 make g++ libc6-compat

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /repo

# Copy the entire monorepo (pruned via .dockerignore)
COPY . .

# Install all workspace deps with the lockfile
RUN pnpm install --frozen-lockfile

# Build the api-server (esbuild → dist/index.cjs)
RUN pnpm --filter @workspace/api-server build

# Materialize a production-only standalone deploy directory at /out.
# pnpm copies workspace:* packages (db, api-zod) into node_modules so we don't
# need to ship the whole monorepo.
RUN pnpm --filter @workspace/api-server deploy --prod /out

# Copy the built bundle into the deploy dir.
RUN cp -R /repo/artifacts/api-server/dist /out/dist

# ---- runtime ----
FROM node:24-alpine AS runtime

ENV NODE_ENV=production

# wget is used by the HEALTHCHECK
RUN apk add --no-cache wget

WORKDIR /app

COPY --from=builder --chown=node:node /out /app

USER node

# API_PORT is set at runtime by Easypanel; default 5000.
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${API_PORT:-5000}/api/healthz" || exit 1

CMD ["node", "dist/index.cjs"]
