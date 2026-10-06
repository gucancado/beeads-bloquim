-- Modelos de plano de ação (spec docs/superpowers/specs/2026-10-05-modelos-de-plano-design.md).
-- Snapshot JSON versionado por usuário; posições relativas ao canto superior
-- esquerdo do conjunto capturado.
-- Aditiva e idempotente. Dev: aplicar com pg direto (NÃO drizzle-kit push,
-- que dropa strategy_* de outra branch). Prod: mesmo SQL, antes do deploy do api.
CREATE TABLE IF NOT EXISTS "plan_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_templates_user" ON "plan_templates" ("user_id");
