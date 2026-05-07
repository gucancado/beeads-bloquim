# Deploy — Bloquim @ Hetzner / Easypanel

Stack de produção:

- **App**: 2 serviços no Easypanel (api-server + mindtask-app), mesmo domínio com roteamento por path.
- **Postgres**: serviço self-hosted no mesmo Easypanel (template oficial).
- **Storage**: Cloudflare R2 (S3-compatible, 10 GB free, sem egress charge).
- **Backup**: cron job no Easypanel rodando `pg_dump` → R2 diariamente.

## Topologia

```
                 https://bloquim.beeads.com.br/
                          │
                  ┌───────┴────────┐
                  │  Traefik       │  (gerenciado pelo Easypanel,
                  │  + Let's Encrypt│   com SSL automático)
                  └───┬─────────┬──┘
                      │ /       │ /api
                      ▼         ▼
              ┌──────────┐  ┌──────────┐
              │ bloquim- │  │ bloquim- │
              │ web      │  │ api      │
              │ (nginx)  │  │ (Express)│
              └──────────┘  └────┬─────┘
                                 │ Docker network interno
                                 ▼
                          ┌──────────────┐         ┌─────────────────┐
                          │ bloquim-db   │         │ Cloudflare R2   │
                          │ (Postgres 17)│         │ (anexos, etc)   │
                          └──────┬───────┘         └────────┬────────┘
                                 │                          │
                                 │   pg_dump diário         │
                                 └──────────────────────────┘
                                        ▲
                                        │
                                ┌───────┴──────┐
                                │ bloquim-     │  (cron job no Easypanel)
                                │ backup       │
                                └──────────────┘
```

| Serviço Easypanel | Container | Porta interna | Domínio / path |
|---|---|---|---|
| `bloquim-web` | mindtask-app build estático servido por nginx | 80 | `<dominio>/` |
| `bloquim-api` | api-server (Node 24, Express + WS) | 5000 | `<dominio>/api` |
| `bloquim-db` | Postgres 17 (template Easypanel) | 5432 | (interno apenas) |
| `bloquim-backup` | imagem custom alpine + pg_dump + aws-cli | — | (cron) |

## Pré-requisitos

- Servidor Hetzner com Easypanel instalado e funcionando.
- Domínio próprio com DNS (A record) apontando para o IP do servidor.
- Repositório no GitHub: `gucancado/beeads-bloquim` (Easypanel buildando direto).
- Conta Cloudflare (free tier serve) com R2 habilitado.

## 1. Conectar GitHub no Easypanel

Easypanel → **Settings → Github** → **Connect Github** → autorize a app no repositório (ou cole um Personal Access Token com leitura no repo).

## 2. Criar o serviço Postgres (`bloquim-db`)

1. Easypanel → **Create Service → Postgres**.
2. Nome do serviço: `bloquim-db`.
3. Versão: `17` (a do template).
4. Senha: gere uma forte e **anote** — vai pra `DATABASE_URL` em todo lugar.
5. Database name: deixe `postgres` (vamos criar `bloquim` em seguida).
6. Volume: deixe o default (volume persistente automático).
7. **Deploy**.

Depois de subir, conecte uma vez via "Console" do Easypanel (ou `psql`) pra criar o database da app:

```sql
CREATE DATABASE bloquim;
```

> Se preferir usar o database `postgres` direto, ajuste a `DATABASE_URL` accordingly e pule esse passo.

**Connection string interna** (usada pelo `bloquim-api`):
```
postgresql://postgres:<DB_PASSWORD>@bloquim-db:5432/bloquim
```

## 3. Aplicar o schema no banco de prod

Da sua máquina local, com o repositório clonado e `pnpm install` feito:

```powershell
# Windows PowerShell — túnel pro Postgres do Easypanel via SSH se não estiver exposto.
# Easypanel não expõe Postgres externo por padrão. Use o "Open Console" do Easypanel
# pra rodar comandos SQL ad-hoc, mas pra drizzle-kit push você precisa de uma rota
# externa. Duas opções:
#
# (A) RECOMENDADO — Túnel SSH temporário pro servidor:
ssh -L 5433:bloquim-db:5432 root@<ip-do-hetzner>
# em outra janela:
$env:DATABASE_URL = "postgresql://postgres:<DB_PASSWORD>@localhost:5433/bloquim"
pnpm --filter @workspace/db run push
# Ctrl-C no túnel quando terminar.
#
# (B) Expor temporariamente o Postgres no Easypanel (Service → Network → Expose port).
# Após o push, FECHE a exposição. Não deixe Postgres aberto pra internet.
```

Resposta esperada: `[✓] Changes applied`.

> Quando estabilizar, considere automatizar via GitHub Actions (workflow `manual` que faz o túnel e roda o push). Por enquanto, manual é suficiente.

## 4. Criar buckets no Cloudflare R2

1. Cloudflare Dashboard → **R2** → **Create bucket** (uma por vez):
   - `bloquim-attachments` (private)
   - `bloquim-avatars` (private)
   - `bloquim-public-assets` (public — habilita "Custom Domain" depois se quiser CDN no seu domínio)
   - `bloquim-backups` (private — backups do Postgres)
2. **R2 → Manage R2 API tokens → Create token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: marque os 4 buckets acima
   - Validade: longa (ou ilimitada — você pode rotacionar depois)
3. Copie e guarde:
   - `Access Key ID`
   - `Secret Access Key`
   - `Endpoint for S3 clients` (formato `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)

## 5. Criar o serviço `bloquim-api`

1. **Create Service → App**.
2. Nome: `bloquim-api`.
3. **Source**:
   - Type: `Github`
   - Owner/Repo: `gucancado/beeads-bloquim`
   - Branch: `main` (ou a que for prod)
   - Build path: `/`
4. **Build**:
   - Type: `Dockerfile`
   - File: `deploy/api-server/Dockerfile`
5. **Environment**: copie de `.env.production.example`, substituindo placeholders. Bloco completo:

   ```
   DATABASE_URL=postgresql://postgres:<DB_PASSWORD>@bloquim-db:5432/bloquim
   API_PORT=5000
   JWT_SECRET=<openssl rand -hex 32>
   INTEGRATIONS_ENCRYPTION_KEY=<openssl rand -base64 32>
   ALLOWED_ORIGINS=https://bloquim.beeads.com.br
   NODE_ENV=production
   LOG_LEVEL=info
   STORAGE_PROVIDER=disabled
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_FORCE_PATH_STYLE=true
   S3_ACCESS_KEY_ID=<R2 access key>
   S3_SECRET_ACCESS_KEY=<R2 secret>
   S3_BUCKET_ATTACHMENTS=bloquim-attachments
   S3_BUCKET_AVATARS=bloquim-avatars
   S3_BUCKET_PUBLIC=bloquim-public-assets
   GOOGLE_CALENDAR_ENABLED=false
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_OAUTH_REDIRECT_URI=https://bloquim.beeads.com.br/api/integrations/google-calendar/callback
   ```

   Gere os secrets:
   ```bash
   openssl rand -hex 32      # JWT_SECRET
   openssl rand -base64 32   # INTEGRATIONS_ENCRYPTION_KEY
   ```

6. **Domains**:
   - Domain: `bloquim.beeads.com.br`
   - Path: `/api`
   - **Strip Path**: **OFF** (Express monta tudo sob `/api`, o path NÃO deve ser removido).
   - HTTPS: ON.
   - Port: `5000`.
7. **Advanced** (recomendado):
   - Health check path: `/api/healthz`.
   - Resources: 0.5 CPU / 512 MB RAM como ponto de partida.
8. **Deploy**.

> WebSocket de presença em `/api/realtime/presence`: Easypanel/Traefik faz upgrade WS automaticamente para serviços com domain configurado. Sem config extra.

## 6. Criar o serviço `bloquim-web`

1. **Create Service → App**.
2. Nome: `bloquim-web`.
3. **Source**: mesmo repo/branch do `bloquim-api`.
4. **Build**:
   - Type: `Dockerfile`
   - File: `deploy/mindtask-app/Dockerfile`
5. **Environment**: vazio. Frontend é estático e tudo já foi assado no build (`BASE_PATH=/`).
6. **Domains**:
   - Domain: `bloquim.beeads.com.br` (o mesmo do api).
   - Path: `/`.
   - HTTPS: ON.
   - Port: `80`.
7. **Deploy**.

A ordem dos paths no Traefik é por especificidade — `/api` (mais específico) é avaliado antes de `/` (catch-all), então o roteamento funciona naturalmente.

## 7. Configurar backup diário (`bloquim-backup`)

1. **Create Service → App**.
2. Nome: `bloquim-backup`.
3. **Source**: mesmo repo/branch.
4. **Build**:
   - Type: `Dockerfile`
   - File: `deploy/backup/Dockerfile`
   - Build context: `deploy/backup` (somente esse diretório, build mais rápido)
5. **Environment**:

   ```
   DATABASE_URL=postgresql://postgres:<DB_PASSWORD>@bloquim-db:5432/bloquim
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET_BACKUPS=bloquim-backups
   AWS_ACCESS_KEY_ID=<R2 access key>      # mesmas credenciais R2 do bloquim-api
   AWS_SECRET_ACCESS_KEY=<R2 secret>
   BACKUP_PREFIX=postgres
   RETENTION_DAYS=30
   ```

6. **Deployment Type**: troque para **Scheduled (Cron)**.
7. **Schedule**: `0 3 * * *` (todo dia às 03:00 UTC = ~00:00 BRT).
8. **Deploy**.

Isso roda `backup-db.sh` (CMD default da imagem) uma vez por dia.

### Cron de prune (opcional, mas recomendado)

Crie um segundo serviço `bloquim-backup-prune` igual ao acima, mas:
- **Override CMD**: `/opt/backup/prune-old-backups.sh`
- **Schedule**: `30 3 * * 0` (domingos às 03:30 UTC)
- Mesmas envs.

Ele apaga backups com mais de `RETENTION_DAYS` dias do bucket.

### Restore manual

Quando precisar restaurar:
```bash
# Pegue o nome do backup desejado:
aws s3 ls s3://bloquim-backups/postgres/ \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com

# Restore (DESTRUTIVO — confirma 10s antes):
docker run --rm -it \
  --network <easypanel-network> \
  -e DATABASE_URL=postgresql://postgres:<PASS>@bloquim-db:5432/postgres \
  -e DATABASE_TARGET=bloquim \
  -e S3_ENDPOINT=... -e S3_REGION=auto -e S3_BUCKET_BACKUPS=bloquim-backups \
  -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... \
  -e BACKUP_KEY=postgres/bloquim-20260101T030000Z.sql.gz \
  bloquim-backup /opt/backup/restore-db.sh
```

## 8. Smoke test pós-deploy

```bash
# Health
curl -i https://bloquim.beeads.com.br/api/healthz
# 200 {"status":"ok"}

# SPA
curl -I https://bloquim.beeads.com.br/
# 200, Content-Type: text/html

# Disparar backup manual (dentro do Easypanel: Run → bloquim-backup):
# verifique no R2 que o arquivo aparece em bloquim-backups/postgres/
```

Abra `https://bloquim.beeads.com.br/` no navegador, registre o primeiro usuário e crie um workspace de smoke.

## 9. Atualizando

Cada `git push` para a branch configurada dispara um rebuild dos 3 serviços (api, web, backup) — desde que você tenha habilitado **Auto Deploy** no serviço.

Para forçar:
- **Easypanel → bloquim-api → Deployments → Deploy**.
- Idem para os outros.

Schema novo (depois de mexer em `lib/db/src/schema/`):
```powershell
# Túnel SSH + drizzle-kit push (mesmo procedimento do passo 3)
```

## 10. Rotação de secrets

| Secret | Onde rotacionar | Impacto |
|---|---|---|
| `DB_PASSWORD` | Postgres dashboard do Easypanel | Atualize `DATABASE_URL` em `bloquim-api` E em `bloquim-backup` E redeploy ambos. |
| `JWT_SECRET` | Easypanel → bloquim-api → Environment | Invalida todas as sessões existentes (todos precisam relogar). |
| `INTEGRATIONS_ENCRYPTION_KEY` | Easypanel → bloquim-api → Environment | **Inutiliza tokens criptografados** de Google Calendar — todos os usuários precisarão reconectar. Não troque sem necessidade. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Cloudflare R2 → API tokens | Atualize em `bloquim-api` E `bloquim-backup` E redeploy. |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console | Atualize em `bloquim-api` e redeploy. |

## 11. Quando habilitar Storage e Google Calendar

- **Storage**: deixe `STORAGE_PROVIDER=disabled` até a Fase 3 (`StorageService` abstrato + provider S3) ser implementada. Endpoints de upload retornam 503 com mensagem clara, e o resto do app funciona normalmente.
- **Google Calendar**: deixe `GOOGLE_CALENDAR_ENABLED=false` até cadastrar o app no Google Cloud Console com:
  - Authorized redirect URI: `https://bloquim.beeads.com.br/api/integrations/google-calendar/callback`
  - Scope: `https://www.googleapis.com/auth/calendar.readonly`
  - Tipo de OAuth consent: External (publicar quando estiver pronto)

## 12. Troubleshooting

| Sintoma | Causa provável | Resolução |
|---|---|---|
| 502 no `/api/*` | `bloquim-api` ainda subindo, crashou, ou env faltando | Veja logs em Easypanel. Provável `DATABASE_URL` errada ou DB inacessível. |
| `connect ECONNREFUSED bloquim-db:5432` | `bloquim-db` ainda não subiu OU nome do serviço diferente | Confirme que o nome do serviço Postgres é exatamente `bloquim-db`. Se trocou, atualize `DATABASE_URL`. |
| 404 ao recarregar rotas internas do SPA (`/workspaces/123`) | nginx sem SPA fallback | Já tratado no `nginx.conf`. Se acontecer, confirme que o build/conf foi atualizado. |
| Cookie `token` não persiste | HTTPS off ou domínio errado | Easypanel deve ter Let's Encrypt ativo; em prod, `Secure` é obrigatório. |
| WebSocket de presença não conecta | Traefik não fez upgrade | Confirme que o domain do `bloquim-api` está configurado (não só Path). |
| Backup falha com `pg_dump: server version mismatch` | Postgres do `bloquim-db` upgradou e `postgresql17-client` ficou pra trás | Edite `deploy/backup/Dockerfile`, troque `postgresql17-client` pra a versão do servidor, e redeploy. |
| `aws s3 cp` falha com 403 | Token R2 sem permissão de escrita no bucket | Recrie o token com Object Read & Write nos buckets corretos. |
| Disco do Postgres lotando | Volume default pequeno | Easypanel → bloquim-db → Storage → aumente o volume. Reinicie. |
