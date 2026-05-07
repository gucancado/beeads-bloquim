# Prompt — Migrar banco PROD do Replit → Supabase prod + R2

Cole este prompt numa **nova conversa Claude Code** no diretório `c:/Users/gusta/Projetos/beeads-bloquim/repo`.

---

## PROMPT (copie tudo abaixo do bloco de código)

> Você está retomando uma migração que deu errado. Resumo:
>
> **O que foi feito antes**:
> - O Bloquim foi reescrito (Fase 3) e deployado em prod no Hetzner (Coolify) + Supabase + Cloudflare R2.
> - Domínio: `https://bloquim.beeads.com.br`. Tudo healthy.
> - Tentei migrar dados do Replit pro Supabase prod via `scripts/migrate-replit-to-prod.mjs`.
> - **Erro do humano**: a migração foi feita contra o banco DEV do Replit, não o PROD.
> - Já limpei o Supabase prod (TRUNCATE all tables) e os buckets R2 prod (`bloquim-attachments-prod`, `bloquim-avatars-prod`). Backup pré-migração preservado em `bloquim-backups-prod/postgres/bloquim-20260507T224914Z.sql.gz`.
>
> **O que você precisa fazer**:
> 1. Validar que o estado atual é mesmo "vazio" (Supabase prod sem rows, R2 attachments+avatars vazios, schema intacto).
> 2. Conduzir o usuário a re-rodar a migração no Replit shell, dessa vez apontando pra **DATABASE_URL do banco PROD do Replit** (e não o dev).
> 3. Depois da migração, executar smoke test ponta-a-ponta em prod.
>
> **Credenciais e endpoints (todos válidos)**:
>
> ```
> # Coolify v4 API (servidor Hetzner Bloquim)
> COOLIFY_URL=http://5.78.199.192:8000
> COOLIFY_TOKEN=1|MdgzIb9sAb8L8klulZ0EXinu8EnQvLDcAmS70rcy93986a7c
>
> # Supabase prod (project bloquim-prod, ref ljilttjsrceddoydnneu)
> # Session pooler — serve para drizzle-kit push, queries diretas e psql
> PROD_DATABASE_URL=postgresql://postgres.ljilttjsrceddoydnneu:KCzB134hRqSy4PQA@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
>
> # Cloudflare R2 prod (account dce6176ee194426f62d6b8cdc56f5df1)
> PROD_S3_ENDPOINT=https://dce6176ee194426f62d6b8cdc56f5df1.r2.cloudflarestorage.com
> PROD_S3_ACCESS_KEY_ID=c46e73299372f79be3cc8e49bed34ceb
> PROD_S3_SECRET_ACCESS_KEY=3b8ee352a37c9d0e7e5aae28a834f56d438db6a23ebe769c66a662304b98d6e9
> PROD_S3_BUCKET_ATTACHMENTS=bloquim-attachments-prod
> PROD_S3_BUCKET_AVATARS=bloquim-avatars-prod
> PROD_S3_BUCKET_PUBLIC=bloquim-public-assets-prod
> PROD_S3_BUCKET_BACKUPS=bloquim-backups-prod
> ```
>
> **Outras infos úteis**:
> - Repo: `https://github.com/gucancado/beeads-bloquim` (branch `master`)
> - Script de migração: `scripts/migrate-replit-to-prod.mjs` (já no GitHub na versão correta — todas as correções aplicadas: path resolution, ordering por parent_task_id NULLS FIRST, idempotência via attachment_link.id, avatar deterministic path)
> - Doc da estratégia: `deploy/replit-migration.md`
> - Diferenças de schema (Replit antigo → atual) tratadas pelo script:
>   - `file_uploads + attachment_links` → tabela única `attachments` com `bucket`, `storage_path`, anchor `task/card/comment/map/plan_id`, soft delete via `deleted_at`
>   - `users.avatar_url` (path antigo) → `avatar_storage_path` + `avatar_url` denormalizado
>   - `mapShapes.fileUploadId` → `mapShapes.attachmentId`
>
> **Etapas**:
>
> ### 1. Validar estado limpo do destino
>
> Use as credenciais Supabase + R2 acima para confirmar:
> - Todas as 19 tabelas do `public` schema do Supabase prod com 0 rows
> - `bloquim-attachments-prod` e `bloquim-avatars-prod` vazios
> - `bloquim-backups-prod` mantém o backup `postgres/bloquim-20260507T224914Z.sql.gz`
> - Coolify: confirme que `bloquim-api` e `bloquim-web` continuam `running:healthy` e o app responde em `https://bloquim.beeads.com.br/api/healthz`
>
> Se algo divergir desse estado, **pare e reporte** antes de prosseguir.
>
> ### 2. Conduzir o usuário a rodar a migração com a DATABASE_URL do Replit PROD
>
> O script roda dentro do Replit shell. O usuário precisa de:
> - Acesso shell ao Repl de PRODUÇÃO do Bloquim no Replit (não o dev)
> - A `DATABASE_URL` desse Repl prod (já vem como env var do shell — `echo $DATABASE_URL`)
> - `PRIVATE_OBJECT_DIR` desse Repl prod (também env var — `echo $PRIVATE_OBJECT_DIR`)
>
> Antes de rodar, **confirme com o usuário**:
> - "O Repl que você abriu agora é o de PROD ou de DEV? Confirma o nome do Repl."
> - "O `echo $DATABASE_URL` resolve para qual host? (Replit prod usa `helium`, mas confirme)"
> - "Quantas tabelas tem? Quantos workspaces, users? Bate com o que você espera ter em prod?"
>
> Sequência no Replit shell (orientação para o usuário copiar):
>
> ```bash
> # 1. Baixar script
> curl -O https://raw.githubusercontent.com/gucancado/beeads-bloquim/master/scripts/migrate-replit-to-prod.mjs
>
> # 2. Garantir deps (algumas podem faltar no root workspace)
> pnpm add -w pg @google-cloud/storage @aws-sdk/client-s3
>
> # 3. Confirmar envs do origem (Replit prod)
> echo "DATABASE_URL=${DATABASE_URL:0:60}..."
> echo "PRIVATE_OBJECT_DIR=$PRIVATE_OBJECT_DIR"
>
> # 4. Definir envs do destino (cole tudo de uma vez)
> export PROD_DATABASE_URL='postgresql://postgres.ljilttjsrceddoydnneu:KCzB134hRqSy4PQA@aws-1-sa-east-1.pooler.supabase.com:5432/postgres'
> export PROD_S3_ENDPOINT='https://dce6176ee194426f62d6b8cdc56f5df1.r2.cloudflarestorage.com'
> export PROD_S3_ACCESS_KEY_ID='c46e73299372f79be3cc8e49bed34ceb'
> export PROD_S3_SECRET_ACCESS_KEY='3b8ee352a37c9d0e7e5aae28a834f56d438db6a23ebe769c66a662304b98d6e9'
> export PROD_S3_BUCKET_ATTACHMENTS='bloquim-attachments-prod'
> export PROD_S3_BUCKET_AVATARS='bloquim-avatars-prod'
>
> # 5. Inventário primeiro (lê os dois lados, não escreve)
> node migrate-replit-to-prod.mjs --inventory
> ```
>
> **Aguarde a saída do `--inventory`**. Compare com o que era esperado em prod (perguntar ao usuário). Se número de users/workspaces/tasks for muito diferente da última tentativa (que tinha 23 users, 14 workspaces, 17 maps, 139 tasks — esses eram do DEV), **provavelmente bate**, mas confirme com ele que esses números fazem sentido para o ambiente prod do Replit.
>
> ### 3. Dry-run e Live
>
> Após validar inventário:
>
> ```bash
> node migrate-replit-to-prod.mjs --dry-run
> ```
>
> Confira na saída:
> - Counts batem com inventário (sem perda)
> - Cada attachment tem ✓ (existe no Replit Object Storage) ou ✗ NOT FOUND ou SKIP orphan
> - Avatares listados
>
> Quando OK:
>
> ```bash
> node migrate-replit-to-prod.mjs --live
> ```
>
> ### 4. Validação final
>
> 1. Conta rows em cada tabela do Supabase prod via psql ou query — deve bater 1:1 com o inventário do Replit (descontando órfãos perdidos).
> 2. Lista objects nos buckets R2 — confirma que arquivos estão lá.
> 3. **Smoke test no navegador**: abrir `https://bloquim.beeads.com.br/`, login com email/senha real do user de prod, ver workspaces, abrir tarefa, baixar anexo, ver avatar.
>
> ### Cuidados
>
> - **NÃO TRUNCATE em prod novamente** sem autorização explícita por escrito do usuário.
> - O script é **idempotente agora** — pode rodar `--live` várias vezes sem duplicar (PK `attachments.id` = `attachment_link.id` da origem).
> - Se houver tabelas no Replit prod que **não existem** no Supabase prod (ex: `task_approvals`, `map_visited` ou outra peculiar do prod antigo), o script vai pular silenciosamente. Veja o log: `"WARN: no overlapping columns — table missing in target"`. Reporte ao usuário se isso aparecer.
> - O backup snapshot do estado atual (vazio + smoke test antigo) está em `bloquim-backups-prod/postgres/bloquim-20260507T224914Z.sql.gz`. **Restore disponível** se algo der errado.
>
> ### Quando terminar
>
> Reporte resultado em formato de tabela: counts esperados vs migrados, anexos migrados vs órfãos pulados, avatares, e link para o app em prod (`https://bloquim.beeads.com.br/`).

---

## Notas para você (humano) antes de iniciar nova conversa

1. **Abra o Repl de PROD do Bloquim** (não o dev). Confirme o nome do Repl.
2. Tenha o shell do Replit aberto numa aba.
3. Abra a nova conversa Claude Code no diretório `c:/Users/gusta/Projetos/beeads-bloquim/repo`.
4. Cole o prompt acima (a parte dentro de `>`).
5. Vai te pedir pra confirmar que está no Repl certo e rodar os comandos. Cole as saídas conforme rodar.

## Estado atual (snapshot agora)

- Supabase prod: **0 rows** em todas tabelas (schema intacto, ready para receber migração)
- R2 prod attachments: **0 objects**
- R2 prod avatars: **0 objects**
- R2 prod backups: **1 object** (snapshot pré-migração)
- App em prod: rodando normalmente em `https://bloquim.beeads.com.br/` (sem dados, mas funcional)
- Smoke test antigo: **apagado** junto com o resto

## Se a próxima sessão não conseguir validar o estado por algum motivo

Os comandos exatos que usei pra limpar:

```bash
# Truncate Supabase prod (já feito — incluído aqui só pra rastreabilidade)
psql "$PROD_DATABASE_URL" -c "TRUNCATE TABLE
  users, workspaces, workspace_members, maps, user_map_access, user_workspace_order,
  map_text_elements, map_shapes, cards, card_connections,
  tasks, subtasks, task_activities, task_comments, task_templates, task_template_subtasks,
  attachments, user_calendar_preferences, user_google_calendar_accounts
  RESTART IDENTITY CASCADE"

# Limpar R2 (já feito)
# Via aws-sdk no Node — ver comando exato no histórico desta sessão
```
