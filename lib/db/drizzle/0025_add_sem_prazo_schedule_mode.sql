-- Add "sem_prazo" (no deadline) to schedule_mode enum.
-- When a task uses this modality, both start_at and due_date are kept null.

ALTER TYPE "schedule_mode" ADD VALUE IF NOT EXISTS 'sem_prazo';
