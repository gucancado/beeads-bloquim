-- Task linking + attachment inheritance — Phase A.
-- See docs/specs/task-linking-and-attachment-inheritance.md
--
-- Phase A (this migration):
--   1. Create `task_attachments` join table (kind per-link).
--   2. Backfill task_attachments from existing `attachments` rows.
--   3. Create `task_links` table.
--   4. Extend `task_activity_type` enum with new types.
--
-- Phase B (future migration, after services/routes are refactored to read from
-- the join table): drop `attachments.task_id`, drop `attachments.kind`, drop
-- type `attachment_kind`, replace `attachments_has_anchor` CHECK with a trigger
-- that allows "anchored via task_attachments".
--
-- During Phase A, BOTH paths are valid: legacy reads via `attachments.task_id`
-- continue to work; new code can start writing/reading via `task_attachments`.
-- The two must be kept in sync until Phase B drops the legacy columns. The
-- service layer is the one place that does the dual-write (see
-- taskAttachmentsService refactor in Phase 2 of the implementation).

-- 1. task_attachment_kind enum -----------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_attachment_kind') THEN
    CREATE TYPE "task_attachment_kind" AS ENUM ('standard', 'deliverable');
  END IF;
END $$;

-- 2. task_attachments table --------------------------------------------------
CREATE TABLE IF NOT EXISTS "task_attachments" (
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "attachment_id" uuid NOT NULL REFERENCES "attachments"("id") ON DELETE CASCADE,
  "kind" "task_attachment_kind" NOT NULL DEFAULT 'standard',
  "inherited_from_task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("task_id", "attachment_id")
);

CREATE INDEX IF NOT EXISTS "idx_task_attachments_task"
  ON "task_attachments" ("task_id");

CREATE INDEX IF NOT EXISTS "idx_task_attachments_attachment"
  ON "task_attachments" ("attachment_id");

CREATE INDEX IF NOT EXISTS "idx_task_attachments_deliverables"
  ON "task_attachments" ("task_id")
  WHERE "kind" = 'deliverable';

CREATE INDEX IF NOT EXISTS "idx_task_attachments_inherited_from"
  ON "task_attachments" ("inherited_from_task_id")
  WHERE "inherited_from_task_id" IS NOT NULL;

-- 3. Backfill task_attachments from existing attachments ---------------------
-- For each live attachment that's anchored to a task, create the equivalent
-- join row. We copy `kind` straight across (the legacy column uses the same
-- 'standard'|'deliverable' values). `inherited_from_task_id` stays NULL —
-- pre-existing attachments are treated as native uploads. `created_by` reuses
-- the uploader; `created_at` reuses the attachment's createdAt to preserve
-- ordering when the listing later joins through this table.
INSERT INTO "task_attachments" (
  "task_id", "attachment_id", "kind", "inherited_from_task_id",
  "created_by", "created_at"
)
SELECT
  a."task_id",
  a."id",
  a."kind"::text::"task_attachment_kind",
  NULL,
  a."uploaded_by",
  a."created_at"
FROM "attachments" a
WHERE a."task_id" IS NOT NULL
  AND a."deleted_at" IS NULL
ON CONFLICT ("task_id", "attachment_id") DO NOTHING;

-- 4. task_links table --------------------------------------------------------
CREATE TABLE IF NOT EXISTS "task_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "plan_id" uuid NOT NULL REFERENCES "maps"("id") ON DELETE CASCADE,
  "source_task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "target_task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "task_links_no_self_loop"
    CHECK ("source_task_id" <> "target_task_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_task_links_source_target"
  ON "task_links" ("source_task_id", "target_task_id");

CREATE INDEX IF NOT EXISTS "idx_task_links_source"
  ON "task_links" ("source_task_id");

CREATE INDEX IF NOT EXISTS "idx_task_links_target"
  ON "task_links" ("target_task_id");

CREATE INDEX IF NOT EXISTS "idx_task_links_plan"
  ON "task_links" ("plan_id");

-- 5. Extend task_activity_type enum ------------------------------------------
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside a transaction; the
-- IF NOT EXISTS clause makes each ADD idempotent so re-running the migration
-- is safe even if drizzle wraps execution in a tx (the IF NOT EXISTS short-
-- circuits before the implicit savepoint matters).
ALTER TYPE "task_activity_type" ADD VALUE IF NOT EXISTS 'task_link_created';
ALTER TYPE "task_activity_type" ADD VALUE IF NOT EXISTS 'task_link_removed';
ALTER TYPE "task_activity_type" ADD VALUE IF NOT EXISTS 'attachment_promoted';
ALTER TYPE "task_activity_type" ADD VALUE IF NOT EXISTS 'attachment_demoted';
ALTER TYPE "task_activity_type" ADD VALUE IF NOT EXISTS 'attachment_unlinked';
