# Integração com Google Agenda no Bloquim

## Objetivo

Permitir que cada usuário conecte sua própria conta Google Agenda ao Bloquim, selecione quais agendas deseja exibir e veja os eventos do dia na página "suas tarefas".

---

## 1) Escopo da funcionalidade

### Funcionalidades incluídas

- conectar conta Google Agenda por usuário
- listar agendas disponíveis da conta conectada
- permitir selecionar quais agendas serão exibidas no Bloquim
- mostrar eventos de hoje na página "suas tarefas"
- exibir/ocultar eventos através de um botão "agenda"

### Fora de escopo

- criar, editar ou excluir eventos
- transformar evento em tarefa
- sincronização em tempo real
- webhooks
- notificações

---

## 2) Autenticação Google

### Escopo OAuth

https://www.googleapis.com/auth/calendar.readonly

### Regras

- integração por usuário
- tokens associados ao usuário autenticado
- armazenar tokens de forma segura (preferencialmente criptografados)
- não compartilhar tokens entre usuários

---

## 3) Configurações da integração

Caminho:

Configurações > Integrações > Google Agenda

### Funcionalidades

- conectar/desconectar conta Google
- listar agendas disponíveis
- ativar/desativar agendas

---

## 4) Estrutura de dados

### Conta Google

user_google_calendar_accounts
- id
- userId
- googleAccountEmail
- accessTokenEncrypted
- refreshTokenEncrypted
- expiresAt
- createdAt
- updatedAt

### Preferências de agendas

user_calendar_preferences
- id
- userId
- googleCalendarId
- calendarName
- calendarColor
- enabled
- createdAt
- updatedAt

---

## 5) Backend

### Endpoints

GET /api/integrations/google-calendar/auth-url  
GET /api/integrations/google-calendar/callback  

GET /api/integrations/google-calendar/status  
POST /api/integrations/google-calendar/disconnect  
GET /api/integrations/google-calendar/calendars  
PATCH /api/integrations/google-calendar/calendars/:calendarId  

GET /api/integrations/google-calendar/today-events  

---

## 6) Busca de eventos

### Regras

- apenas eventos do dia atual
- respeitar timezone
- incluir eventos com horário e dia inteiro
- ordenar por horário

### Cache

- cache de 5 a 15 minutos por usuário

---

## 7) Frontend - Página "suas tarefas"

### Botão

Agenda

### Comportamento

- inicia recolhido
- ao clicar:
  - expande eventos
  - busca dados no backend

---

## 8) Estados

- Não conectado
- Sem agendas
- Sem eventos
- Erro

---

## 9) Segurança

- apenas leitura
- tokens protegidos
- nunca expor tokens no frontend

---

## 10) Validação

- conexão funciona
- agendas aparecem
- eventos aparecem corretamente

---

## 11) Restrições

- sem webhooks
- sem edição de eventos
