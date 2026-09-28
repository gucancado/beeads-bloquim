-- Modo calendário (kanban semanal) das listas de tarefas.
-- planned_date: data de execução pretendida (só o calendário lê/escreve).
-- planned_order: ordem de prioridade dentro da coluna do dia; NULL = nunca
-- ordenada manualmente (cai na ordem padrão aprovação → reunião → tarefa).
-- Aditiva e idempotente. Dev: aplicar com pg direto (NÃO drizzle-kit push,
-- que dropa strategy_* de outra branch). Prod: mesmo SQL, no deploy.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_date date;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_order integer;
--> statement-breakpoint
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS planned_order integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_planned ON tasks (assigned_to, planned_date) WHERE planned_date IS NOT NULL;
