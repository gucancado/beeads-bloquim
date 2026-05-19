-- Add "urgente" to schedule_mode enum. Same shape as "sem_prazo" (no
-- start_at / due_date), but tasks with this modality are pinned to the top
-- of every list sort (see CASE ordering in workspaceTasks.ts and myTasks.ts).

ALTER TYPE "schedule_mode" ADD VALUE IF NOT EXISTS 'urgente';
