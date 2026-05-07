# syntax=docker/dockerfile:1.7

# ---- builder ----
FROM node:24-alpine AS builder

RUN apk add --no-cache python3 make g++ libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /repo

COPY . .

# --prod=false ensures vite, @vitejs/plugin-react, tailwind, etc. (devDeps) are
# installed even when NODE_ENV=production is injected by the build platform.
RUN pnpm install --frozen-lockfile --prod=false

# Build args for Vite. The frontend hits the API via the same origin (path /api),
# so VITE_API_BASE_URL is left unset on purpose (no proxy in prod).
# WEB_PORT is required by vite.config.ts even at build time, so we provide a dummy.
ENV NODE_ENV=production \
    BASE_PATH=/ \
    WEB_PORT=3000

RUN pnpm --filter @workspace/mindtask-app build

# ---- runtime: nginx serving static assets ----
FROM nginx:1.27-alpine AS runtime

# Replace default site config with our SPA-friendly one
RUN rm /etc/nginx/conf.d/default.conf
COPY deploy/mindtask-app/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built assets
COPY --from=builder /repo/artifacts/mindtask-app/dist/public /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
