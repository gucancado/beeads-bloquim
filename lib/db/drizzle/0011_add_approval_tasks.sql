CREATE TYPE IF NOT EXISTS "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');
CREATE TYPE IF NOT EXISTS "public"."approval_mode" AS ENUM('sequential', 'parallel');

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "is_approval_task" boolean NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_task_id" uuid REFERENCES "tasks"("id") ON DELETE CASCADE;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approval_order" integer;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approval_status" "public"."approval_status";
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "approval_mode" "public"."approval_mode";
