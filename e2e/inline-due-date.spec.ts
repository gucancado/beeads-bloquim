import { test, expect, request as pwRequest, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Regressão da edição INLINE de prazo nas listas de tarefas (TaskListItem):
 *   1. trocar a data de uma tarefa "fazer até" pelo calendário da linha;
 *   2. definir prazo numa tarefa "sem prazo" (modalidade → "fazer até" → data);
 *   3. o mesmo que (1) na versão não-compacta da coluna (filtro != em andamento).
 *
 * Cada teste captura `pageerror`/`console.error` e falha se aparecer qualquer
 * um — o bug que este spec pina é um ReferenceError silencioso no handler de
 * modalidade (setModalityOpen sem estado), que aborta o clique sem toast.
 */

const API = process.env.API_BASE_URL ?? "http://localhost:5000";
const PASSWORD = "E2ePass12345!";

type Seed = {
  api: APIRequestContext;
  workspaceId: string;
  stamp: number;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Data-alvo no MESMO mês da data base, pra não precisar navegar o calendário. */
function sameMonthTarget(base: Date): Date {
  const x = new Date(base);
  x.setDate(base.getDate() <= 14 ? base.getDate() + 7 : base.getDate() - 7);
  return x;
}

async function login(api: APIRequestContext, email: string) {
  const res = await api.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function seed(): Promise<Seed> {
  const stamp = Date.now();
  const api = await pwRequest.newContext({ baseURL: API });
  await login(api, "e2e_tasks_owner@test.local");
  const wsRes = await api.post("/api/workspaces", { data: { name: `E2E Prazo ${stamp}`, colorIndex: 0 } });
  expect(wsRes.ok(), `workspace: ${wsRes.status()} ${await wsRes.text()}`).toBeTruthy();
  const workspaceId = (await wsRes.json()).id as string;
  return { api, workspaceId, stamp };
}

async function createTask(
  s: Seed,
  body: Record<string, unknown>,
  status: "pending" | "in_progress",
): Promise<{ id: string; title: string }> {
  const res = await s.api.post(`/api/workspaces/${s.workspaceId}/tasks`, { data: body });
  expect(res.ok(), `task: ${res.status()} ${await res.text()}`).toBeTruthy();
  const task = await res.json();
  const st = await s.api.patch(`/api/workspaces/${s.workspaceId}/tasks/${task.id}/status`, { data: { status } });
  expect(st.ok(), `status: ${st.status()} ${await st.text()}`).toBeTruthy();
  return { id: task.id, title: body.title as string };
}

async function getTask(s: Seed, id: string) {
  const res = await s.api.get(`/api/workspaces/${s.workspaceId}/tasks/${id}`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function authenticate(context: BrowserContext, api: APIRequestContext) {
  const state = await api.storageState();
  await context.addCookies(
    state.cookies.map((c) => ({ ...c, domain: "localhost", path: "/", secure: false })),
  );
}

/**
 * Só erros REAIS: exceções não tratadas (pageerror) e console.error do próprio
 * app (handler inline falhou / toast). Warnings do Base UI, 503 de feature
 * desligada (agenda em dev) e props desconhecidas ficam de fora.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/ReferenceError|TypeError|Inline (edit|status update|card title edit) failed|Não foi possível/.test(text)) {
      errors.push(`console.error: ${text}`);
    }
  });
  return errors;
}

async function pickDay(page: Page, target: Date) {
  const cell = page.locator(`td[data-day="${ymd(target)}"] button`);
  await expect(cell, "dia-alvo visível no calendário").toBeVisible({ timeout: 15_000 });
  await cell.click();
}

test.describe("prazo inline na lista de Minhas Tarefas", () => {
  let s: Seed;

  test.beforeAll(async () => {
    s = await seed();
  });

  test.afterAll(async () => {
    await s.api.delete(`/api/workspaces/${s.workspaceId}`);
    await s.api.dispose();
  });

  test("troca a data de uma tarefa 'fazer até' (coluna compacta)", async ({ page, context }) => {
    const due = addDays(new Date(), 3);
    const target = sameMonthTarget(due);
    const t = await createTask(s, { title: `E2E ate compacta ${s.stamp}`, scheduleMode: "ate", dueDate: ymd(due) }, "in_progress");

    const errors = collectErrors(page);
    await authenticate(context, s.api);
    await page.goto("/my-tasks?window=todas");
    const row = page.locator("tr", { hasText: t.title });
    await expect(row).toBeVisible({ timeout: 60_000 });

    await row.getByTitle("Alterar fazer").click();
    await pickDay(page, target);

    await expect
      .poll(async () => (await getTask(s, t.id)).dueDate?.slice(0, 10), { timeout: 15_000 })
      .toBe(ymd(target));
    await expect(page.getByText("Não foi possível salvar a alteração.")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("define prazo numa tarefa 'sem prazo': modalidade → fazer até → data", async ({ page, context }) => {
    const target = sameMonthTarget(addDays(new Date(), 3));
    const t = await createTask(s, { title: `E2E sem prazo ${s.stamp}` }, "in_progress");

    const errors = collectErrors(page);
    await authenticate(context, s.api);
    await page.goto("/my-tasks?window=todas");
    const row = page.locator("tr", { hasText: t.title });
    await expect(row).toBeVisible({ timeout: 60_000 });

    await row.getByTitle("Clique para alterar modalidade de prazo").click();
    await page.getByRole("button", { name: "fazer até", exact: true }).click();

    // Depois de escolher "fazer até" a célula deve virar o seletor de data.
    const dateBtn = row.getByTitle("Alterar fazer");
    await expect(dateBtn, "seletor de data não apareceu").toBeVisible({ timeout: 10_000 }).catch((e: Error) => {
      throw new Error(`${e.message}\n\nerros de página capturados:\n${errors.join("\n") || "(nenhum)"}`);
    });
    await dateBtn.click();
    await pickDay(page, target);

    await expect
      .poll(async () => {
        const task = await getTask(s, t.id);
        return `${task.scheduleMode}|${task.dueDate?.slice(0, 10)}`;
      }, { timeout: 15_000 })
      .toBe(`ate|${ymd(target)}`);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("troca a data de uma tarefa 'fazer até' (coluna completa, filtro pronta e aguardando)", async ({ page, context }) => {
    const due = addDays(new Date(), 3);
    const target = sameMonthTarget(due);
    const t = await createTask(s, { title: `E2E ate completa ${s.stamp}`, scheduleMode: "ate", dueDate: ymd(due) }, "pending");

    const errors = collectErrors(page);
    await authenticate(context, s.api);
    await page.goto("/my-tasks?status=pending&window=todas");
    const row = page.locator("tr", { hasText: t.title });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row.getByTitle("Modalidade do fazer")).toBeVisible();

    await row.getByTitle("Alterar fazer").click();
    await pickDay(page, target);

    await expect
      .poll(async () => (await getTask(s, t.id)).dueDate?.slice(0, 10), { timeout: 15_000 })
      .toBe(ymd(target));
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
