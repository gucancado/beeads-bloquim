-- T2.6: Integridade
-- 1) task_comments.author_id: NOT NULL → nullable + ON DELETE SET NULL
--    Motivo: deletar usuário não pode bloquear deleção (FK NO ACTION).
--    Comentários históricos são preservados (anonimizados) em vez de cascateados.
-- 2) workspace_members: promover unique index existente a UNIQUE constraint nomeada,
--    deixando a integridade visível em pg_constraint (não só em pg_indexes).
--    O índice é reaproveitado (sem rebuild) e mantém o mesmo nome.

-- ── task_comments.author_id ──────────────────────────────────────────────
ALTER TABLE "task_comments"
  DROP CONSTRAINT IF EXISTS "task_comments_author_id_users_id_fk";

ALTER TABLE "task_comments"
  ALTER COLUMN "author_id" DROP NOT NULL;

ALTER TABLE "task_comments"
  ADD CONSTRAINT "task_comments_author_id_users_id_fk"
  FOREIGN KEY ("author_id") REFERENCES "users"("id")
  ON DELETE SET NULL;

-- ── workspace_members: UNIQUE constraint a partir do índice existente ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'idx_workspace_members_workspace_user'
      AND conrelid = 'workspace_members'::regclass
  ) THEN
    ALTER TABLE "workspace_members"
      ADD CONSTRAINT "idx_workspace_members_workspace_user"
      UNIQUE USING INDEX "idx_workspace_members_workspace_user";
  END IF;
END $$;
