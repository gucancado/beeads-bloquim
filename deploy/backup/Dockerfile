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

COPY backup-db.sh restore-db.sh prune-old-backups.sh /opt/backup/
RUN chmod +x /opt/backup/*.sh

# Default command runs the backup. Easypanel cron schedules invoke it on a
# timer; you can override CMD per-invocation (e.g. for prune or restore).
CMD ["/opt/backup/backup-db.sh"]
