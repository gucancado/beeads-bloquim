-- Task #181: schedule modalities (até / entre / em)
-- Adds `schedule_mode` enum + column and `start_at` timestamp to tasks.
-- Existing rows default to "ate" (the old single-due-date behavior).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_mode') THEN
    CREATE TYPE "schedule_mode" AS ENUM ('ate', 'entre', 'em');
  END IF;
END $$;

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "start_at" timestamp;

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "schedule_mode" "schedule_mode" NOT NULL DEFAULT 'ate';
