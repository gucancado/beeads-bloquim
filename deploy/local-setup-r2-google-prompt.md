# Prompt — Finalizar setup local (Cloudflare R2 + Google Calendar)

Use este prompt no **Claude Code** rodando no diretório do repo `beeads-bloquim`. O prompt cobre as duas integrações que ainda não estão ligadas no ambiente local:

- **Parte 1 — Cloudflare R2 (Storage)**: obrigatória se você quiser testar uploads de anexos, avatar e imagens de shape no canvas.
- **Parte 2 — Google Calendar OAuth**: opcional. Só é necessária se você quiser testar a integração com Google Calendar no dev.

Não há MCP do Cloudflare R2 nem do Google Cloud Console disponível, então as ações no dashboard externo são manuais — o Claude vai te guiar passo a passo, e roda toda a parte de configuração do `.env` local + restart dos dev servers + smoke test ponta-a-ponta.

---

## Como usar

1. Abra o Claude Code no diretório do repo `c:/Users/gusta/Projetos/beeads-bloquim/repo`.
2. Cole o prompt abaixo.
3. Tenha em mãos: conta Cloudflare (free tier serve) e, opcionalmente, conta Google Cloud (free).
4. Mantenha o api-server e o vite dev rodando em background (se já estiverem; senão o Claude reinicia).

---

## Prompt (copie tudo abaixo)

> Você está finalizando o setup local do Bloquim. O app já está rodando contra o Supabase `bloquim-dev` com `STORAGE_PROVIDER=disabled` e `GOOGLE_CALENDAR_ENABLED=false`. Sua tarefa é ligar essas duas integrações em dev e validar end-to-end.
>
> **Contexto**:
> - `.env` local fica em `c:/Users/gusta/Projetos/beeads-bloquim/repo/.env`. Ele já contém placeholders para `S3_*` e `GOOGLE_*`.
> - api-server roda em `http://localhost:5000` via `pnpm --filter @workspace/api-server run dev`.
> - vite roda em `http://localhost:3000` (proxy `/api` → 5000) via `pnpm --filter @workspace/mindtask-app run dev`.
> - Há um usuário de smoke test: `gustavo+smoke@bloquim.local` / `test1234` no Supabase dev. Cookie pode estar em `/tmp/cookies.txt` se for sessão recente.
> - StorageService é abstraído em `@workspace/storage`, provider S3-compatible (testado contra Cloudflare R2). Singleton em `artifacts/api-server/src/lib/storage.ts`.
>
> Trabalhe na ordem abaixo. Pare e reporte se algo divergir.
>
> ---
>
> ### Parte 1 — Cloudflare R2 (obrigatória)
>
> #### 1.1 Verifique o estado atual
>
> Leia `repo/.env` e me reporte o valor atual de `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` (mascarado mostrando só os 4 primeiros e 4 últimos chars), e `S3_BUCKET_*`. Se tudo já estiver preenchido com valores reais (não placeholders), pule para 1.4. Caso contrário, siga para 1.2.
>
> #### 1.2 Crie os buckets no Cloudflare (instrua o usuário)
>
> Diga ao usuário:
>
> > Abra https://dash.cloudflare.com → escolha sua conta → menu lateral **R2 Object Storage** → **Create bucket** (uma por vez):
> >
> > | Nome do bucket           | Visibility |
> > |--------------------------|------------|
> > | `bloquim-attachments`    | Private    |
> > | `bloquim-avatars`        | Private    |
> > | `bloquim-public-assets`  | Public     |
> > | `bloquim-backups`        | Private    |
> >
> > Depois de criados, vá em **R2 → Manage R2 API tokens → Create API token**:
> >
> > - **Token name**: `bloquim-dev`
> > - **Permissions**: **Object Read & Write**
> > - **Specify bucket**: marque os 4 buckets acima
> > - **TTL**: ilimitado (ou um ano, sua escolha)
> >
> > Após criar, copie e me cole nesta conversa, em UM bloco:
> >
> > ```
> > Account ID: <ACCOUNT_ID>
> > Access Key ID: <ACCESS_KEY_ID>
> > Secret Access Key: <SECRET_ACCESS_KEY>
> > ```
> >
> > A senha aparece UMA VEZ na criação do token — não fecha a aba antes de copiar.
>
> Aguarde o usuário responder. Não invente valores.
>
> #### 1.3 Atualize o `.env` local
>
> Quando o usuário colar as credenciais, edite `repo/.env`:
>
> - `STORAGE_PROVIDER=s3`
> - `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
> - `S3_REGION=auto`
> - `S3_FORCE_PATH_STYLE=true`
> - `S3_ACCESS_KEY_ID=<ACCESS_KEY_ID>`
> - `S3_SECRET_ACCESS_KEY=<SECRET_ACCESS_KEY>`
> - `S3_BUCKET_ATTACHMENTS=bloquim-attachments`
> - `S3_BUCKET_AVATARS=bloquim-avatars`
> - `S3_BUCKET_PUBLIC=bloquim-public-assets`
>
> NÃO commite o `.env` (já está no `.gitignore` do projeto).
>
> #### 1.4 Restart do api-server
>
> Mate o processo antigo do api-server e suba de novo:
>
> ```powershell
> # ache o PID na 5000 e mate (no Windows):
> netstat -ano | findstr ":5000 "
> taskkill /F /PID <pid>
> ```
>
> Depois:
>
> ```powershell
> cd c:/Users/gusta/Projetos/beeads-bloquim/repo
> pnpm --filter @workspace/api-server run dev
> ```
>
> Em background. Confirme que o log mostra `storage service initialized` com `provider: "s3"` (o singleton de [artifacts/api-server/src/lib/storage.ts](repo/artifacts/api-server/src/lib/storage.ts) loga isso na primeira chamada). Se mostrar `disabled`, o `.env` não foi recarregado — diagnostique antes de seguir.
>
> #### 1.5 Smoke test ponta-a-ponta de upload
>
> Use credenciais do usuário de smoke test. Se `/tmp/cookies.txt` não existir ou estiver expirado, faça login:
>
> ```bash
> curl -sS -X POST http://localhost:5000/api/auth/login \
>   -H "Content-Type: application/json" \
>   -d '{"email":"gustavo+smoke@bloquim.local","password":"test1234"}' \
>   -c /tmp/cookies.txt
> ```
>
> Pegue o `taskId` de uma tarefa existente do workspace de smoke (id `7ed98b3c-ea11-48fb-8119-51c2f6c6817f`):
>
> ```bash
> curl -sS http://localhost:5000/api/workspaces/7ed98b3c-ea11-48fb-8119-51c2f6c6817f/tasks -b /tmp/cookies.txt | head -200
> ```
>
> Se não houver tarefa, crie uma rapidamente via SQL no Supabase MCP ou via `curl POST /api/my-tasks`.
>
> Com o `taskId` em mão:
>
> 1. **Request URL**:
>    ```bash
>    curl -sS -X POST http://localhost:5000/api/storage/uploads/request-url \
>      -b /tmp/cookies.txt -H "Content-Type: application/json" \
>      -d '{"bucket":"attachments","entityKind":"task","entityId":"<TASK_ID>","filename":"smoke.txt","contentType":"text/plain","sizeBytes":12}' | tee /tmp/upload_response.json
>    ```
>    Espera HTTP 201 com `attachmentId`, `uploadUrl`, `headers`, `storagePath`.
>
> 2. **PUT no signed URL**:
>    ```bash
>    UPLOAD_URL=$(jq -r .uploadUrl /tmp/upload_response.json)
>    echo -n "smoke test!" > /tmp/smoke.txt
>    curl -sS -X PUT "$UPLOAD_URL" -H "Content-Type: text/plain" --data-binary @/tmp/smoke.txt -w "\nHTTP %{http_code}\n"
>    ```
>    Espera HTTP 200 (R2 retorna 200 em PUT bem sucedido).
>
> 3. **Verifique no Cloudflare dashboard**: o arquivo deve aparecer em `bloquim-attachments` com path tipo `workspace/<wsId>/task/<taskId>/<attachmentId>-smoke.txt`. Reporte o resultado.
>
> 4. **List + Download**:
>    ```bash
>    curl -sS http://localhost:5000/api/workspaces/7ed98b3c-ea11-48fb-8119-51c2f6c6817f/tasks/<TASK_ID>/attachments -b /tmp/cookies.txt
>    ATTACHMENT_ID=$(jq -r .attachmentId /tmp/upload_response.json)
>    curl -sS http://localhost:5000/api/storage/attachments/${ATTACHMENT_ID}/download -b /tmp/cookies.txt -w "\nHTTP %{http_code}\n"
>    ```
>    Listagem deve mostrar o anexo. Download deve retornar `smoke test!` com HTTP 200.
>
> 5. **Soft delete**:
>    ```bash
>    curl -sS -X DELETE http://localhost:5000/api/workspaces/7ed98b3c-ea11-48fb-8119-51c2f6c6817f/tasks/<TASK_ID>/attachments/${ATTACHMENT_ID} -b /tmp/cookies.txt -w "\nHTTP %{http_code}\n"
>    ```
>    Espera HTTP 200 com `{"success":true}`. Confirme via SQL que `deleted_at IS NOT NULL` na linha. O arquivo continua no R2 (limpeza física é problema do GC futuro).
>
> 6. **Validações que devem falhar**:
>    - Tente uploadar com extensão bloqueada:
>      ```bash
>      curl -sS -X POST http://localhost:5000/api/storage/uploads/request-url \
>        -b /tmp/cookies.txt -H "Content-Type: application/json" \
>        -d '{"bucket":"attachments","entityKind":"task","entityId":"<TASK_ID>","filename":"malware.exe","contentType":"application/octet-stream","sizeBytes":1024}' -w "\nHTTP %{http_code}\n"
>      ```
>      Espera HTTP 400 com `error: "FILE_EXTENSION_BLOCKED"`.
>    - Tamanho > 50 MB: idem, HTTP 400 com `FILE_TOO_LARGE`.
>
> #### 1.6 Smoke test de avatar
>
> ```bash
> curl -sS -X POST http://localhost:5000/api/auth/me/avatar/upload-url \
>   -b /tmp/cookies.txt -H "Content-Type: application/json" \
>   -d '{"filename":"me.png","contentType":"image/png","sizeBytes":1024}' | tee /tmp/avatar_response.json
> ```
>
> Espera HTTP 201 com `uploadUrl`, `avatarUrl: "/api/users/<userId>/avatar"`. Faça PUT de um PNG real (qualquer pequeno) e depois:
>
> ```bash
> curl -sS -o /tmp/avatar_back.png http://localhost:5000/api/users/bbda9166-caf4-4ea3-97bd-ed8d9edb0bc8/avatar -b /tmp/cookies.txt -w "\nHTTP %{http_code}\n"
> file /tmp/avatar_back.png
> ```
>
> Espera HTTP 200, content-type `image/png`, e o arquivo de volta tem que ser idêntico ao enviado.
>
> #### 1.7 Validação visual
>
> Diga ao usuário para abrir `http://localhost:3000` no navegador (ou recarregar a aba), abrir uma tarefa do workspace de smoke, anexar um arquivo via UI, e trocar a foto de perfil. Espere ele confirmar antes de prosseguir.
>
> #### 1.8 Reporte final da Parte 1
>
> Resumo no formato:
>
> ```
> [R2] Buckets:           ✓ 4 criados (attachments, avatars, public-assets, backups)
> [R2] Token:             ✓ Object R/W com escopo nos 4 buckets
> [R2] .env atualizado:   ✓ STORAGE_PROVIDER=s3 + S3_*
> [API] Boot:             ✓ storage service initialized — provider: s3
> [Smoke] Upload anexo:   ✓ HTTP 201 + R2 confirma arquivo
> [Smoke] Download:       ✓ HTTP 200 + bytes idênticos
> [Smoke] Soft delete:    ✓ deleted_at populado
> [Smoke] Validações:     ✓ .exe e >50MB rejeitados
> [Smoke] Avatar:         ✓ upload + GET retorna PNG válido
> [UI]    Confirmação:    ✓ usuário validou anexo e avatar via navegador
> ```
>
> ---
>
> ### Parte 2 — Google Calendar OAuth (opcional)
>
> Pergunte ao usuário se ele quer fazer agora. Se não, encerre.
>
> #### 2.1 Pré-requisitos no Google Cloud Console
>
> Diga ao usuário:
>
> > 1. Acesse https://console.cloud.google.com → crie um projeto (ex: `bloquim-dev`).
> > 2. **APIs & Services → Library → Google Calendar API → Enable**.
> > 3. **APIs & Services → OAuth consent screen**:
> >    - User type: **External** (será **Testing** até publicar; OK para dev).
> >    - App name: `Bloquim Dev`.
> >    - User support email + Developer contact: seu email.
> >    - Scopes: adicione `.../auth/calendar.readonly`.
> >    - Test users: adicione seu email Google que vai usar.
> > 4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
> >    - Application type: **Web application**.
> >    - Name: `Bloquim Dev`.
> >    - **Authorized redirect URIs**: `http://localhost:5000/api/integrations/google-calendar/callback`
> > 5. Copie e me cole:
> >    ```
> >    GOOGLE_CLIENT_ID=<...>.apps.googleusercontent.com
> >    GOOGLE_CLIENT_SECRET=GOCSPX-<...>
> >    ```
>
> Aguarde o usuário responder.
>
> #### 2.2 Atualize o `.env`
>
> - `GOOGLE_CALENDAR_ENABLED=true`
> - `GOOGLE_CLIENT_ID=<...>`
> - `GOOGLE_CLIENT_SECRET=<...>`
> - `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:5000/api/integrations/google-calendar/callback` (já deve estar)
>
> Restart api-server (mesmo procedimento da Parte 1.4).
>
> #### 2.3 Smoke test do OAuth flow
>
> ```bash
> # Status inicial: deve retornar connected: false
> curl -sS http://localhost:5000/api/integrations/google-calendar/status -b /tmp/cookies.txt
>
> # Pega a URL de auth
> curl -sS http://localhost:5000/api/integrations/google-calendar/auth-url -b /tmp/cookies.txt | tee /tmp/google_auth.json
> ```
>
> Diga ao usuário para abrir no navegador a URL retornada (`url` no JSON). Ele faz login Google, autoriza, e o Google redireciona para `http://localhost:5000/api/integrations/google-calendar/callback?code=...&state=...`. Backend processa e redireciona o navegador para `/settings/integrations?google_calendar=connected`.
>
> Confirme:
>
> ```bash
> curl -sS http://localhost:5000/api/integrations/google-calendar/status -b /tmp/cookies.txt
> # Espera: {"connected":true,"googleAccountEmail":"<email do usuário>"}
>
> curl -sS http://localhost:5000/api/integrations/google-calendar/calendars -b /tmp/cookies.txt | jq '.[].name' | head -10
> # Lista as agendas do Google
>
> curl -sS "http://localhost:5000/api/integrations/google-calendar/today-events?tz=America/Sao_Paulo" -b /tmp/cookies.txt
> # Eventos do dia (ou {events: [], noCalendarsSelected: true} se nenhuma agenda foi habilitada)
> ```
>
> #### 2.4 Reporte final da Parte 2
>
> ```
> [Google] OAuth client criado:    ✓
> [Google] .env atualizado:        ✓ GOOGLE_CALENDAR_ENABLED=true
> [API]    Boot:                   ✓ no error sobre google calendar
> [OAuth]  auth-url:               ✓ retorna URL Google válida
> [OAuth]  Callback:               ✓ redireciona connected=true
> [OAuth]  status:                 ✓ connected=true, email correto
> [OAuth]  Lista calendários:      ✓ <N> agendas
> [OAuth]  today-events:           ✓ resposta válida
> ```
>
> ---
>
> ### Importante
>
> - **Nunca cole credenciais R2 ou Google em conversas públicas, screenshots públicos ou commits.** O `.env` está no `.gitignore`.
> - Se o usuário pedir para configurar produção também, **não faça nessa sessão** — produção tem credenciais separadas e os passos estão em `deploy/README.md`. Apenas mencione.
> - Se algo falhar, **pare e reporte** com:
>   - O que tentou
>   - Output exato (erro completo, status code, body)
>   - Hipótese da causa
>   - Não tente "consertar criando código" — provavelmente é misconfig de env ou bucket.

---

## Checklist do que você (humano) precisa antes

- [ ] Conta Cloudflare ativa (free tier serve).
- [ ] Repositório clonado e dev servers rodando (api-server + vite).
- [ ] `.env` local existe em `repo/.env` (vai ser editado pelo Claude).
- [ ] Para a Parte 2: conta Google que vai usar o calendar e acesso ao Google Cloud Console.

## Depois que rodar

- Estado final do dev local: app 100% funcional, anexos no R2, Google Calendar conectado.
- Para produção (Hetzner + Easypanel): use os mesmos buckets R2 (com prefixos diferentes se quiser separar) ou crie buckets `bloquim-attachments-prod` etc, gere outro token API só pra prod, e siga `deploy/README.md`.
- O backup automatizado (`bloquim-backup` cron job no Easypanel) usa o bucket `bloquim-backups` que você já criou nessa sessão. Reaproveitável.
