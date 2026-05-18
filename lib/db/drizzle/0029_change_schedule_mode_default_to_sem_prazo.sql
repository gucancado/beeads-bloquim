-- Change default schedule_mode for new tasks from 'ate' to 'sem_prazo'.
-- Existing rows keep their current value; this only affects INSERTs that
-- don't specify schedule_mode (the api-server now sets it explicitly in
-- all task-creation routes, but cards.ts POST / and direct SQL inserts
-- still rely on the column default).

ALTER TABLE "tasks"
  ALTER COLUMN "schedule_mode" SET DEFAULT 'sem_prazo';
