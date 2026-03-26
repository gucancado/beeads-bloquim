#!/bin/bash
set -e
pnpm install --frozen-lockfile
psql "$DATABASE_URL" -tc "SELECT 1 FROM pg_constraint WHERE conname = 'card_connections_source_target_unique'" | grep -q 1 || \
  psql "$DATABASE_URL" -c "ALTER TABLE card_connections ADD CONSTRAINT card_connections_source_target_unique UNIQUE (source_card_id, target_card_id)"
pnpm --filter db push
