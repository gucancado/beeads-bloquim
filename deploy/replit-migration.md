# Migração Replit → Supabase prod + R2

Migração one-shot dos dados do app rodando no Replit (banco Postgres antigo + arquivos no Replit Object Storage) para a stack nova (Supabase Postgres prod + Cloudflare R2 prod).

## Diferenças de schema (Replit antigo → atual)

A Fase 3 reescreveu três pontos do banco. A migração tem que **transformar** durante a importação.

### Anexos

| Antigo (Replit) | Novo (Supabase prod) |
|---|---|
| `file_uploads` (id, object_path, file_name, file_size, mime_type, uploaded_by, created_at) | (eliminada) |
| `attachment_links` (id, file_upload_id, entity_type, entity_id, kind, created_at) | (eliminada) |
| ↓ junção 1:N | ↓ |
| 2 tabelas | 1 tabela `attachments` |

Mapeamento:
- `attachment_links.entity_type='task'` → `attachments.task_id = entity_id`
- `attachment_links.entity_type='map'` → `attachments.map_id = entity_id` (imagens de shape no canvas)
- `attachment_links.entity_type='card'` → `attachments.card_id = entity_id` (se existir)
- `attachments.workspace_id`: derivado via lookup da entidade pai (task→tasks.workspaceId, map→maps.workspaceId)
- `attachments.bucket`: `'attachments'` para todos (no antigo não havia distinção)
- `attachments.storage_path`: novo path canônico no R2, formato `workspace/{wId}/{kind}/{entityId}/{attachmentId}-{filename}`
- `attachments.original_filename`: `file_uploads.file_name`
- `attachments.mime_type`, `file_size`, `uploaded_by`, `created_at`, `kind`: cópia direta

### Avatar

| Antigo | Novo |
|---|---|
| `users.avatar_url = '/api/storage/objects/uploads/<uuid>'` | `users.avatar_storage_path = 'user/<userId>/avatar/<uuid>-<filename>'` + `users.avatar_url = '/api/users/<userId>/avatar'` |

Lookup do filename real do avatar antigo via Replit Object Storage metadata. Como o caminho antigo não tem filename original, vamos usar `avatar.<ext-detectada>` derivada do mime_type do arquivo.

### Imagens de shape no canvas

| Antigo | Novo |
|---|---|
| `map_shapes.file_upload_id` → `file_uploads.id` | `map_shapes.attachment_id` → `attachments.id` |
| `attachment_links` com `entity_type='map'` | (não usado — referência fica no `map_shapes.attachment_id`) |

Na migração: quando criamos a row `attachments` para um shape image, capturamos seu novo `id` e atualizamos `map_shapes.attachment_id` correspondente.

### Tabelas idênticas (cópia 1:1, sem transformação)

`workspaces`, `workspace_members`, `users` (exceto avatar_url), `maps`, `map_text_elements`, `cards`, `card_connections`, `tasks`, `task_activities`, `task_comments`, `task_templates`, `task_template_subtasks`, `subtasks`, `user_google_calendar_accounts`, `user_calendar_preferences`, `user_map_access`, `user_workspace_order`.

Tokens criptografados em `user_google_calendar_accounts` (`access_token_encrypted`, `refresh_token_encrypted`) usam a `INTEGRATIONS_ENCRYPTION_KEY`. Como geramos uma **nova** chave para prod, **esses tokens ficarão inválidos após migração**. Solução: limpar a tabela; usuários reconectam Google Calendar uma vez. Documentar pra avisar usuários.

### Tabelas que podem ou não existir no Replit antigo

- `task_approvals` — existia no Bloquim original, mas foi convertido para usar `task_activities` e tasks-aprovadoras (`isApprovalTask=true`). Vai depender da versão do Replit.
- `map_visited` — existia para "recent maps". Pode ter sido renomeada para `user_map_access` ou similar.

Vou inventariar no Replit primeiro pra confirmar antes de migrar.

## Arquivos no Object Storage

### Origem
- Replit Object Storage com sidecar `127.0.0.1:1106` (acessível só de dentro do Replit)
- Bucket interno definido por `PUBLIC_OBJECT_SEARCH_PATHS` e `PRIVATE_OBJECT_DIR`
- Paths: `/objects/uploads/<uuid>` (sem extensão)

### Destino
- R2 buckets prod: `bloquim-attachments-prod` e `bloquim-avatars-prod`
- Paths canônicos novos:
  - Anexos: `workspace/{wId}/{entityKind}/{entityId}/{attachmentId}-{filename}`
  - Avatares: `user/{userId}/avatar/{uuid}-{filename}`

### Mapeamento

Para cada `file_upload`:
1. Resolver entidade pai via `attachment_links` (task/map/card)
2. Resolver workspace_id via FK da entidade
3. Construir novo storage_path
4. Copiar bytes Replit → R2 prod
5. Inserir row em `attachments` no Supabase prod com path novo
6. Se for shape image: atualizar `map_shapes.attachment_id` com o novo id

Para avatares (em `users.avatar_url`):
1. Extrair UUID antigo do path `/api/storage/objects/uploads/<uuid>`
2. Detectar extensão via metadata do objeto (mime_type)
3. Construir novo path: `user/<userId>/avatar/<uuid>-avatar.<ext>`
4. Copiar bytes Replit → R2 prod (bucket `bloquim-avatars-prod`)
5. Atualizar `users.avatar_storage_path` e `users.avatar_url`

## Estratégia de execução

Fluxo em 3 etapas:

### Etapa 1 — Export do Replit (rodar dentro do Replit)

Script `migrate-export-from-replit.mjs` que:
1. Conecta no Postgres do Replit (env `DATABASE_URL`)
2. Faz `pg_dump` (texto) de cada tabela em ordem de dependência → arquivo `.sql.gz`
3. Conecta no sidecar Replit Object Storage
4. Lista todos os objetos em `PRIVATE_OBJECT_DIR/uploads/`
5. Faz download de cada objeto, salva metadata (mime_type, size, content) em arquivo manifest JSON
6. Empacota tudo num diretório `replit-export-<timestamp>/`

Output: `dump.sql.gz` + `objects/<uuid>` (bytes) + `manifest.json` (mime_type/path por uuid)

### Etapa 2 — Import + transform (rodar localmente, contra Supabase prod + R2 prod)

Script `migrate-import-to-prod.mjs` que:
1. Lê o `dump.sql.gz` num banco temporário local (Postgres em Docker ou Supabase dev)
2. Para cada tabela 1:1, faz `INSERT INTO supabase_prod (...) SELECT ... FROM temp` via duas conexões
3. Para `attachments`:
   - JOIN `file_uploads` + `attachment_links` no temp
   - Lookup workspace_id via entidade pai
   - Constrói storage_path canônico novo
   - INSERT em `attachments` (Supabase prod)
   - Faz upload do byte do `objects/<uuid>` para R2 prod no novo path
   - Mantém um mapping `file_upload_id → new_attachment_id` em memória
4. Para `map_shapes`:
   - INSERT 1:1 dos campos exceto `file_upload_id` 
   - UPDATE depois preenchendo `attachment_id` via mapping
5. Para `users.avatar_url`:
   - Identifica avatares (URL prefix), upload pra R2 `bloquim-avatars-prod`, atualiza `avatar_storage_path` + `avatar_url` denorm

### Etapa 3 — Validação

Script `migrate-verify.mjs`:
1. Counts antes/depois por tabela
2. Spot check: para 5 attachments aleatórios, baixa via signed URL R2 e compara hash com Replit original
3. Smoke test: login com user real do Replit migrado (mesmo email/senha) → vê seus workspaces, abre tarefa, baixa anexo, confirma visualmente

## Cuidados

1. **Backup do Supabase prod ANTES** — apesar de estar essencialmente vazio (só smoke), garante rollback. O `bloquim-backup` já está configurado, dispara antes.
2. **Reservar `bloquim-prod-staging`** opcional — fazer dry run num projeto Supabase staging antes do prod definitivo.
3. **Modo manutenção em prod**: enquanto migra, app fica indisponível. Hoje não há usuários reais em prod — só smoke test que vou apagar antes de migrar.
4. **Idempotência**: scripts checam se row já existe antes de inserir, pra permitir re-run em caso de falha parcial.
5. **Tokens Google Calendar**: ficam inválidos após migração (chave de criptografia diferente). Avisar usuários.
6. **Senhas (`password_hash`)** continuam válidas — bcrypt hash, não depende de chave de app.
7. **Volume estimado**: usuário precisa informar para escolher abordagem (streaming vs batch local).

## O que preciso de você

1. **Replit ainda tem o app de prod ativo?** (sim/não — se não, talvez você tenha export antigo)
2. **Acesso ao Replit Shell** — pra rodar o `migrate-export-from-replit.mjs` lá dentro (precisa do sidecar Object Storage)
3. **DATABASE_URL do Postgres do Replit prod** (visível em Replit → Database → Connect)
4. **Variáveis do Replit Object Storage** (visíveis em Replit → Object Storage):
   - `PUBLIC_OBJECT_SEARCH_PATHS`
   - `PRIVATE_OBJECT_DIR`
   - `defaultBucketID` (do .replit, ou variável `REPLIT_OBJSTORE_BUCKET_ID`)
5. **Volume aproximado**: quantos workspaces, users, anexos? (Pra eu dimensionar streaming vs batch)
6. **Versão atual do schema do Replit**: rode `\dt` no psql do Replit e me mande a saída — quero confirmar que não há tabelas que eu não conheço.
