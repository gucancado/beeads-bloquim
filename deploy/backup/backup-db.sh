#!/usr/bin/env bash
#
# pg_dump → gzip → S3 (Cloudflare R2 compatible)
#
# Required env vars (set in the Easypanel scheduled task):
#   DATABASE_URL              postgres://user:pass@host:5432/db (read access enough)
#   S3_ENDPOINT               https://<account>.r2.cloudflarestorage.com
#   S3_REGION                 auto (R2) | us-east-1 (AWS) | etc.
#   S3_BUCKET_BACKUPS         e.g. bloquim-backups
#   AWS_ACCESS_KEY_ID         R2 access key with Object Read & Write on the bucket
#   AWS_SECRET_ACCESS_KEY     paired secret
#
# Optional:
#   BACKUP_PREFIX             Path inside bucket (default: "postgres")
#   BACKUP_LABEL              Custom label appended to filename (default: empty)
#   PG_DUMP_EXTRA_ARGS        Extra flags forwarded to pg_dump

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_BUCKET_BACKUPS:?S3_BUCKET_BACKUPS is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"

PREFIX="${BACKUP_PREFIX:-postgres}"
LABEL="${BACKUP_LABEL:+-${BACKUP_LABEL}}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="bloquim${LABEL}-${TIMESTAMP}.sql.gz"
S3_KEY="${PREFIX}/${FILENAME}"
S3_URL="s3://${S3_BUCKET_BACKUPS}/${S3_KEY}"

echo "[backup] starting at ${TIMESTAMP}"
echo "[backup] target: ${S3_URL}"

# pg_dump streams plain SQL, gzip compresses inline, aws s3 cp - reads from stdin.
# --no-owner / --no-privileges keep the dump portable (restorable into a fresh DB).
pg_dump \
    "${DATABASE_URL}" \
    --format=plain \
    --no-owner \
    --no-privileges \
    --quote-all-identifiers \
    --schema=public \
    ${PG_DUMP_EXTRA_ARGS:-} \
  | gzip -9 \
  | aws s3 cp - "${S3_URL}" \
      --endpoint-url "${S3_ENDPOINT}" \
      --region "${S3_REGION}" \
      --expected-size 5000000000

echo "[backup] uploaded ${FILENAME}"

# Quick sanity check: HEAD the object so a silent failure surfaces.
aws s3api head-object \
  --bucket "${S3_BUCKET_BACKUPS}" \
  --key "${S3_KEY}" \
  --endpoint-url "${S3_ENDPOINT}" \
  --region "${S3_REGION}" \
  >/dev/null

echo "[backup] verified ${S3_URL}"
