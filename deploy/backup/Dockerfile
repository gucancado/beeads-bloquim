# syntax=docker/dockerfile:1.7
#
# Lightweight backup runner: pg_dump → gzip → S3 (Cloudflare R2 compatible).
# Used by an Easypanel scheduled task; not part of the app runtime.

FROM alpine:3.20

# postgresql17-client must match the major version of the Postgres server.
# Easypanel's official Postgres template currently ships PG 17 — bump here if
# you upgrade the server.
RUN apk add --no-cache \
      bash \
      ca-certificates \
      coreutils \
      curl \
      gzip \
      postgresql17-client \
      aws-cli

WORKDIR /opt/backup

# Build context is the monorepo root (Coolify/Easypanel default), so we
# reference the scripts by their full path within the repo.
COPY deploy/backup/backup-db.sh deploy/backup/restore-db.sh deploy/backup/prune-old-backups.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh

# Default command keeps the container alive (idle). Coolify/Easypanel
# scheduled tasks invoke `/opt/backup/backup-db.sh` (and prune/restore)
# inside this running container at the configured cadence.
CMD ["sleep", "infinity"]
