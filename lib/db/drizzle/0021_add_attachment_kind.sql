-- Task #189: attachment kinds (standard vs deliverable)
-- Adds an `attachment_kind` enum and a `kind` column to `attachment_links`
-- so we can mark certain attachments as "deliverables" — the ones an approver
-- needs to evaluate. Existing rows fall back to "standard" via the column
-- default; no backfill needed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attachment_kind') THEN
    CREATE TYPE "attachment_kind" AS ENUM ('standard', 'deliverable');
  END IF;
END $$;

ALTER TABLE "attachment_links"
  ADD COLUMN IF NOT EXISTS "kind" "attachment_kind" NOT NULL DEFAULT 'standard';
