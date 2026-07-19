-- Make attachments.workspace_id nullable + two new task_activity_type values.
--
-- workspace_id DROP NOT NULL: standalone tasks (tasks.workspace_id IS NULL) can
--   now own attachments. The FK to workspaces(id) ON DELETE CASCADE is kept; a
--   NULL workspace_id simply means the attachment is anchored to a standalone
--   task rather than a workspace.
--
-- attachment_added / attachment_removed: emitted when an attachment is linked to
--   or unlinked from a task via the MCP-driven tools. metadata carries
--   { attachmentId, filename }.
--
-- NOTE: ADD VALUE cannot run inside a transaction block on older Postgres. Drizzle
--   wraps each migration in a txn (breakpoints), so IF NOT EXISTS is used to keep
--   the statements idempotent and safe if any get re-run.

ALTER TABLE "attachments" ALTER COLUMN "workspace_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TYPE "public"."task_activity_type" ADD VALUE IF NOT EXISTS 'attachment_added';
--> statement-breakpoint
ALTER TYPE "public"."task_activity_type" ADD VALUE IF NOT EXISTS 'attachment_removed';
