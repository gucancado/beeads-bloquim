import { test, expect, request as pwRequest, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * UI regression for the "nova tarefa" flow on /my-tasks:
 * create the task, attach it to a workspace inside the modal, then edit every
 * field (status, responsável, plano, título, prioridade) without closing it.
 *
 * The bug this pins: the modal froze its API scope on the workspaceId prop it
 * was opened with (always empty on Minhas Tarefas), so after picking a
 * workspace every write still went to /api/my-tasks/* → 403 → toast
 * "Erro ao atualizar status" and nothing persisted.
 */

const API = process.env.API_BASE_URL ?? "http://localhost:5000";
const PASSWORD = "E2ePass12345!";

type Seed = {
  api: APIRequestContext;
  ownerEmail: string;
  ownerName: string;
  mateName: string;
  mateId: string;
  workspaceName: string;
  workspaceId: string;
  mapName: string;
  mapId: string;
};

// Fixed accounts seeded straight in the dev DB by seed-users.mjs — the register
// endpoint is rate-limited per IP (1h), so the spec only ever logs in.
async function login(api: APIRequestContext, email: string) {
  const res = await api.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return body.user ?? body;
}

async function seed(): Promise<Seed> {
  const stamp = Date.now();
  const ownerEmail = "e2e_tasks_owner@test.local";
  const mateEmail = "e2e_tasks_mate@test.local";
  const ownerName = "E2E Owner";
  const mateName = "E2E Mate";

  const mateApi = await pwRequest.newContext({ baseURL: API });
  const mate = await login(mateApi, mateEmail);
  const mateId = (mate.id ?? mate.user?.id) as string;
  await mateApi.dispose();

  const api = await pwRequest.newContext({ baseURL: API });
  await login(api, ownerEmail);

  const workspaceName = `E2E Tarefas ${stamp}`;
  const wsRes = await api.post("/api/workspaces", { data: { name: workspaceName, colorIndex: 0 } });
  expect(wsRes.ok(), `workspace: ${wsRes.status()} ${await wsRes.text()}`).toBeTruthy();
  const workspaceId = (await wsRes.json()).id as string;

  const memberRes = await api.post(`/api/workspaces/${workspaceId}/members`, {
    data: { email: mateEmail, role: "editor" },
  });
  expect(memberRes.ok(), `member: ${memberRes.status()} ${await memberRes.text()}`).toBeTruthy();

  const mapName = `Plano E2E ${stamp}`;
  const mapRes = await api.post(`/api/workspaces/${workspaceId}/maps`, { data: { name: mapName } });
  expect(mapRes.ok(), `map: ${mapRes.status()} ${await mapRes.text()}`).toBeTruthy();
  const mapId = (await mapRes.json()).id as string;

  return { api, ownerEmail, ownerName, mateName, mateId, workspaceName, workspaceId, mapName, mapId };
}

async function authenticate(context: BrowserContext, api: APIRequestContext) {
  const state = await api.storageState();
  await context.addCookies(
    state.cookies.map((c) => ({ ...c, domain: "localhost", path: "/", secure: false })),
  );
}

test("cria tarefa em Minhas Tarefas, atribui workspace e edita todos os campos", async ({ page, context }) => {
  const s = await seed();

  await authenticate(context, s.api);
  await page.goto("/my-tasks");
  await expect(page.getByRole("button", { name: "nova tarefa" }).first()).toBeVisible({ timeout: 60_000 });

  // 1. Nova tarefa -> o modal auto-cria uma tarefa standalone.
  await page.getByRole("button", { name: "nova tarefa" }).first().click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  const titleInput = modal.getByPlaceholder("Nome da tarefa");
  await expect(titleInput).toHaveValue("nova tarefa", { timeout: 30_000 });

  await expect(page).toHaveURL(/\/my-tasks\/tasks\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const taskId = page.url().split("/").pop()!;

  // 2. Escolhe o workspace dentro do modal.
  await modal.getByLabel("alterar espaço de trabalho").click();
  await page.getByRole("option", { name: s.workspaceName }).click();
  await expect(modal.getByLabel("alterar espaço de trabalho")).toContainText(s.workspaceName);

  await expect
    .poll(async () => (await s.api.get(`/api/workspaces/${s.workspaceId}/tasks/${taskId}`)).status())
    .toBe(200);

  // 3. Status: o clique que antes falhava com "Erro ao atualizar status".
  await modal.getByRole("button", { name: "pronta para fazer", exact: true }).click();
  await expect(page.getByText("Erro ao atualizar status")).toHaveCount(0);
  await expect
    .poll(async () => (await s.api.get(`/api/workspaces/${s.workspaceId}/tasks/${taskId}`)).json().then((t) => t.status))
    .toBe("in_progress");

  // 4. Responsável: o picker (avatar) só é renderizado em tarefa de workspace —
  //    em standalone o campo é uma caixa read-only com o nome do dono.
  const assigneeTrigger = modal.locator(
    'xpath=//label[contains(., "Responsável")]/following-sibling::button[1]',
  );
  await expect(assigneeTrigger).toBeVisible();
  await assigneeTrigger.click();
  await page.getByRole("button", { name: s.mateName }).click();
  await expect
    .poll(async () => (await s.api.get(`/api/workspaces/${s.workspaceId}/tasks/${taskId}`)).json().then((t) => t.assignedTo))
    .toBe(s.mateId);

  // 5. Plano.
  await modal.getByLabel("alterar plano").click();
  await page.getByRole("option", { name: s.mapName }).click();
  await expect
    .poll(async () => (await s.api.get(`/api/workspaces/${s.workspaceId}/tasks/${taskId}`)).json().then((t) => t.mapId))
    .toBe(s.mapId);

  // 6. Prioridade (badge de estrelas -> popover) + título (autosave no blur).
  await modal.locator('xpath=//label[contains(., "Prioridade")]/following-sibling::div[1]//*[@aria-haspopup or @aria-expanded]').first().click();
  await page.getByRole("button", { name: /alta/i }).first().click();
  await expect
    .poll(async () => (await s.api.get(`/api/workspaces/${s.workspaceId}/tasks/${taskId}`)).json().then((t) => t.priority))
    .toBe("high");

  await titleInput.fill("tarefa editada pelo e2e");
  await titleInput.blur();
  await expect
    .poll(async () => (await s.api.get(`/api/workspaces/${s.workspaceId}/tasks/${taskId}`)).json().then((t) => t.title))
    .toBe("tarefa editada pelo e2e");

  // 7. Estado final persiste depois de reabrir a página.
  await page.goto(`/my-tasks/tasks/${taskId}`);
  const reopened = page.getByRole("dialog");
  await expect(reopened.getByPlaceholder("Nome da tarefa")).toHaveValue("tarefa editada pelo e2e", { timeout: 30_000 });
  await expect(reopened.getByLabel("alterar espaço de trabalho")).toContainText(s.workspaceName);

  await s.api.delete(`/api/workspaces/${s.workspaceId}`);
  await s.api.dispose();
});
