-- New task_activity_type values used by the MCP-driven tools.
--
-- checklist_items_added: emitted by POST /:taskId/subtasks (workspace + standalone)
--   when one or more checklist items are appended. Always one row per call,
--   regardless of how many items were inserted — metadata.itemCount carries
--   the count and metadata.sampleText carries the first item's text.
--
-- task_moved: emitted by POST /my-tasks/:taskId/move-to-workspace when a
--   standalone task is reparented under a workspace. metadata.toWorkspaceId
--   and metadata.toAssigneeId record the destination.

ALTER TYPE "public"."task_activity_type" ADD VALUE IF NOT EXISTS 'checklist_items_added';
--> statement-breakpoint
ALTER TYPE "public"."task_activity_type" ADD VALUE IF NOT EXISTS 'task_moved';
