-- Add tasks.created_by to track which user created a task. Used by DELETE
-- routes to enforce "only the creator can delete" — workspace admins still
-- bypass via role check; standalone tasks fall back to assignedTo when
-- created_by is NULL (rows pre-dating this migration).
--
-- FK uses ON DELETE SET NULL so deleting a user does not cascade-delete their
-- authored tasks; existing access controls (workspace membership, standalone
-- assignment) keep them visible.

ALTER TABLE "tasks"
  ADD COLUMN "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Backfill standalone tasks: in standalone, the creator is always the
-- assignee (see POST /my-tasks — assignedTo is set to req.user.userId).
UPDATE "tasks"
  SET "created_by" = "assigned_to"
  WHERE "workspace_id" IS NULL
    AND "created_by" IS NULL;
--> statement-breakpoint

-- Backfill workspace tasks from task_activities: the first 'task_created'
-- row carries the original creator's actor_id. Rows without such an
-- activity (or activities with NULL actor) stay as created_by = NULL —
-- the DELETE handler rejects those via API.
UPDATE "tasks" t
  SET "created_by" = ta."actor_id"
  FROM (
    SELECT DISTINCT ON ("task_id") "task_id", "actor_id"
    FROM "task_activities"
    WHERE "type" = 'task_created' AND "actor_id" IS NOT NULL
    ORDER BY "task_id", "created_at" ASC
  ) ta
  WHERE t."id" = ta."task_id"
    AND t."created_by" IS NULL;
