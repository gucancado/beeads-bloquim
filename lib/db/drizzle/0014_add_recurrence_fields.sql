ALTER TABLE "tasks" ADD COLUMN "is_recurring" boolean NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN "recurrence_config" jsonb;
