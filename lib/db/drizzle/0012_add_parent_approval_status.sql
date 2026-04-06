CREATE TYPE IF NOT EXISTS "public"."parent_approval_status" AS ENUM('in_approval', 'approved', 'rejected');

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "parent_approval_status" "public"."parent_approval_status";
