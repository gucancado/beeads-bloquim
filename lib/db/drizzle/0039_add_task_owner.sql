-- RENUMBERED 0038 -> 0039 ao rebasear task-owner em master: o 0038 já era
-- 0038_attachments_nullable_workspace_and_activity (colisão de número).
-- NOTA: o meta/_journal.json + snapshots do drizzle NÃO foram atualizados aqui
-- (a cadeia de snapshots precisa de um `drizzle-kit generate` limpo na
-- finalização da feature). Prod aplica via `drizzle-kit push` (schema-diff do TS
-- schema, que já contém owner_id pós-rebase), então isto é artefato/documentação
-- + o backfill manual abaixo — não um passo de migrate sequencial.
--
-- Add tasks.owner_id: a mutable "owner" of a task, distinct from created_by
-- (immutable creator, used for delete-auth) and assigned_to (responsável).
-- Default on INSERT = creator; transferable via the task PATCH endpoints, which
-- record an `owner_changed` activity. Used by the task-list "rascunho" (draft)
-- status filter, which scopes drafts by owner instead of assignee.
--
-- FK ON DELETE SET NULL so deleting a user does not cascade-delete their tasks.
-- Nullable for pre-migration rows and deleted owners.
--
-- NOTE: prod schema is applied via `drizzle-kit push` (see deploy/README.md),
-- which only syncs DDL — it does NOT run the backfill below. When deploying,
-- run this file's backfill UPDATE against prod manually (session pooler 5432)
-- after the push, or run this whole file directly. Statements are idempotent.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "owner_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TYPE "task_activity_type" ADD VALUE IF NOT EXISTS 'owner_changed';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_tasks_owner_id" ON "tasks" ("owner_id");
--> statement-breakpoint

-- Backfill: owner defaults to the creator, falling back to the assignee for
-- rows that pre-date created_by. Rows with neither stay NULL (true orphans).
UPDATE "tasks"
  SET "owner_id" = COALESCE("created_by", "assigned_to")
  WHERE "owner_id" IS NULL;
