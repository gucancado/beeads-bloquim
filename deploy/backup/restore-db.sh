#!/usr/bin/env bash
#
# Restore a backup from S3 into a Postgres instance.
# DESTRUCTIVE — drops and recreates the target database. Confirm before running.
#
# Usage (inside the backup container):
#   docker run --rm -it \
#     -e DATABASE_URL=postgres://postgres:PASS@bloquim-db:5432/postgres \
#     -e DATABASE_TARGET=bloquim \
#     -e S3_ENDPOINT=... -e S3_REGION=... -e S3_BUCKET_BACKUPS=... \
#     -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... \
#     -e BACKUP_KEY=postgres/bloquim-20260101T030000Z.sql.gz \
#     bloquim-backup /opt/backup/restore-db.sh
#
# DATABASE_URL must point to an admin DB (typically `postgres`) with rights to
# DROP/CREATE the target. DATABASE_TARGET is the database that will be replaced.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (admin connection, e.g. .../postgres)}"
: "${DATABASE_TARGET:?DATABASE_TARGET is required (db name to drop+create+restore into)}"
: "${S3_ENDPOINT:?}"
: "${S3_REGION:?}"
: "${S3_BUCKET_BACKUPS:?}"
: "${BACKUP_KEY:?BACKUP_KEY is required (e.g. postgres/bloquim-20260101T030000Z.sql.gz)}"
: "${AWS_ACCESS_KEY_ID:?}"
: "${AWS_SECRET_ACCESS_KEY:?}"

echo "[restore] WARNING: this will DROP database '${DATABASE_TARGET}' and recreate it."
echo "[restore] backup: s3://${S3_BUCKET_BACKUPS}/${BACKUP_KEY}"
echo "[restore] press Ctrl-C within 10s to abort..."
sleep 10

TMP_DUMP="$(mktemp -t bloquim-restore-XXXXXX.sql.gz)"
trap 'rm -f "${TMP_DUMP}"' EXIT

echo "[restore] downloading backup..."
aws s3 cp "s3://${S3_BUCKET_BACKUPS}/${BACKUP_KEY}" "${TMP_DUMP}" \
  --endpoint-url "${S3_ENDPOINT}" \
  --region "${S3_REGION}"

echo "[restore] dropping and recreating database ${DATABASE_TARGET}..."
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<SQL
DROP DATABASE IF EXISTS "${DATABASE_TARGET}";
CREATE DATABASE "${DATABASE_TARGET}";
SQL

# Build a connection string pointing at the restored DB (replace path component).
RESTORE_URL="$(echo "${DATABASE_URL}" | sed -E "s#/[^/?]+(\?|$)#/${DATABASE_TARGET}\1#")"

echo "[restore] streaming dump into ${DATABASE_TARGET}..."
gunzip -c "${TMP_DUMP}" | psql "${RESTORE_URL}" -v ON_ERROR_STOP=1 -q

echo "[restore] done."
