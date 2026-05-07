#!/usr/bin/env bash
#
# Delete S3 objects older than $RETENTION_DAYS under $BACKUP_PREFIX.
# Run on a separate schedule (e.g. weekly) to keep the bucket lean.
#
# Required env vars:
#   S3_ENDPOINT, S3_REGION, S3_BUCKET_BACKUPS,
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#
# Optional:
#   BACKUP_PREFIX        default: "postgres"
#   RETENTION_DAYS       default: 30

set -euo pipefail

: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_BUCKET_BACKUPS:?S3_BUCKET_BACKUPS is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"

PREFIX="${BACKUP_PREFIX:-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CUTOFF_EPOCH="$(( $(date -u +%s) - RETENTION_DAYS * 86400 ))"

echo "[prune] cutoff: $(date -u -d "@${CUTOFF_EPOCH}" +%Y-%m-%dT%H:%M:%SZ) (${RETENTION_DAYS}d retention)"
echo "[prune] scanning s3://${S3_BUCKET_BACKUPS}/${PREFIX}/"

deleted=0
while IFS=$'\t' read -r date_str time_str size key; do
  [ -z "${key:-}" ] && continue
  obj_epoch="$(date -u -d "${date_str}T${time_str}Z" +%s 2>/dev/null || echo 0)"
  if [ "${obj_epoch}" -lt "${CUTOFF_EPOCH}" ] && [ "${obj_epoch}" -gt 0 ]; then
    echo "[prune] deleting ${key} (uploaded ${date_str} ${time_str}Z)"
    aws s3 rm "s3://${S3_BUCKET_BACKUPS}/${key}" \
      --endpoint-url "${S3_ENDPOINT}" \
      --region "${S3_REGION}"
    deleted=$((deleted + 1))
  fi
done < <(
  aws s3api list-objects-v2 \
    --bucket "${S3_BUCKET_BACKUPS}" \
    --prefix "${PREFIX}/" \
    --endpoint-url "${S3_ENDPOINT}" \
    --region "${S3_REGION}" \
    --query 'Contents[].[LastModified,Size,Key]' \
    --output text 2>/dev/null \
  | awk '{ split($1, d, "T"); print d[1] "\t" substr(d[2], 1, 8) "\t" $2 "\t" $3 }'
)

echo "[prune] done — deleted ${deleted} object(s)"
