-- Track when a task transitions to status "blocked" (cancelled). Parallel to
-- completed_at: set explicitly by the status-mutation paths (myTasks PATCH
-- /:taskId/status and the central taskStatusService). Used by the frontend to
-- sort cancelled tasks by recency when the user filters by status=blocked.

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;
