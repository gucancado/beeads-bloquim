-- Phase B: drop the legacy attachment-anchor columns and the sync trigger
-- introduced in 0034. After this migration:
--   - task anchoring lives entirely in `task_attachments`
--   - `attachments` keeps only file metadata + the non-task anchors
--     (card_id, comment_id, map_id, plan_id)
--   - per-link `kind` lives on `task_attachments` (the file itself has no kind)
--
-- Pre-conditions enforced by the application code (in this same merge):
--   - `taskAttachmentsService.createTaskAttachment` and `routes/storage.ts`
--     INSERT into task_attachments directly (no longer rely on the trigger)
--   - reads use `task_attachments`-based joins everywhere
--
-- This is non-reversible without re-creating the trigger and backfilling
-- attachments.kind / task_id from the join table — possible but lossy when
-- an attachment has been inherited or promoted into multiple tasks.

DROP TRIGGER IF EXISTS trg_attachments_sync_task_links ON attachments;
DROP FUNCTION IF EXISTS sync_task_attachments_from_legacy();

-- Old anchor CHECK and the per-task index both referenced task_id.
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_has_anchor;
DROP INDEX IF EXISTS idx_attachments_task;

ALTER TABLE attachments DROP COLUMN IF EXISTS task_id;
ALTER TABLE attachments DROP COLUMN IF EXISTS kind;

DROP TYPE IF EXISTS attachment_kind;
