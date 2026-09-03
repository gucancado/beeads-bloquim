import { test, expect, request as pwRequest, type APIRequestContext, type BrowserContext, type Page, type Locator } from "@playwright/test";

/**
 * Célula de prazo INLINE nas listas de tarefas (TaskListItem):
 *   - exibe "até X" / "entre X e Y" / "em X" (X, Y no formato do formatDueDate);
 *   - o texto inteiro é um botão que abre um popover colado ao campo com o
 *     campo "modalidade de prazo", 1 calendário (até/em) ou 2 (entre) e os
 *     atalhos "hoje" / "amanhã" sob cada calendário;
 *   - cada mudança persiste na hora (autosave).
 *
 * Cada teste captura pageerror/console.error do app e falha se aparecer
 * algum — a regressão original (setModalityOpen sem estado) era um
 * ReferenceError silencioso, sem toast.
 */

const API = process.env.API_BASE_URL ?? "http://localhost:5000";
const PASSWORD = "E2ePass12345!";
const WEEKDAY_PT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

type Seed = { api: APIRequestContext; workspaceId: string; stamp: number };

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

function today(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** Espelha `formatDueDate` do app (hoje / ontem / amanhã / dia da semana / dd/MM). */
function fmt(d: Date): string {
  const diff = Math.round((d.getTime() - today().getTime()) / 86_400_000);
  if (diff === 0) return "hoje";
  if (diff === -1) return "ontem";
  if (diff === 1) return "amanhã";
  if (diff > 1 && diff <= 6) return WEEKDAY_PT[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return d.getFullYear() === today().getFullYear() ? `${dd}/${mm}` : `${dd}/${mm}/${d.getFullYear()}`;
}

/** Rótulo de "fazer em": só data numérica ganha o "em" (evita "em hoje" / "em terça"). */
function emLabel(d: Date): string {
  const f = fmt(d);
  return /^\d{2}\/\d{2}/.test(f) ? `em ${f}` : f;
}

/** Data no MESMO mês de `base` (o calendário abre no mês da data selecionada). */
function sameMonth(base: Date, delta: number, fallback: number): Date {
  const a = addDays(base, delta);
  if (a.getMonth() === base.getMonth()) return a;
  return addDays(base, fallback);
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
  return { api, workspaceId: (await wsRes.json()).id as string, stamp };
}

async function createTask(s: Seed, body: Record<string, unknown>): Promise<{ id: string; title: string }> {
  const res = await s.api.post(`/api/workspaces/${s.workspaceId}/tasks`, { data: body });
  expect(res.ok(), `task: ${res.status()} ${await res.text()}`).toBeTruthy();
  const task = await res.json();
  const st = await s.api.patch(`/api/workspaces/${s.workspaceId}/tasks/${task.id}/status`, { data: { status: "in_progress" } });
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
  await context.addCookies(state.cookies.map((c) => ({ ...c, domain: "localhost", path: "/", secure: false })));
}

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

async function openList(page: Page, context: BrowserContext, s: Seed, title: string): Promise<Locator> {
  await authenticate(context, s.api);
  await page.goto("/my-tasks?window=todas");
  const row = page.locator("tr", { hasText: title });
  await expect(row).toBeVisible({ timeout: 60_000 });
  return row;
}

/** Botão-texto do prazo na linha ("até X", "entre X e Y", "em X", "sem prazo", "urgente"). */
function scheduleTrigger(row: Locator): Locator {
  return row.getByTitle("Configurar prazo");
}

/** Popover de configuração de prazo (base-ui Popover.Popup tem role=dialog). */
function schedulePopover(page: Page): Locator {
  return page.getByRole("dialog").filter({ hasText: "modalidade de prazo" });
}

async function pickDay(scope: Locator, target: Date) {
  const cell = scope.locator(`td[data-day="${ymd(target)}"] button`);
  await expect(cell, `dia ${ymd(target)} visível no calendário`).toBeVisible({ timeout: 15_000 });
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

  test("exibe 'até X', 'entre X e Y' e 'em X' na coluna de prazo", async ({ page, context }) => {
    const due = addDays(today(), 10);
    const start = addDays(today(), 3);
    const single = addDays(today(), 5);
    const ate = await createTask(s, { title: `E2E exibe até ${s.stamp}`, scheduleMode: "ate", dueDate: ymd(due) });
    const entre = await createTask(s, { title: `E2E exibe entre ${s.stamp}`, scheduleMode: "entre", startAt: ymd(start), dueDate: ymd(due) });
    const em = await createTask(s, { title: `E2E exibe em ${s.stamp}`, scheduleMode: "em", dueDate: ymd(single) });

    const errors = collectErrors(page);
    const rowAte = await openList(page, context, s, ate.title);
    await expect(scheduleTrigger(rowAte)).toHaveText(`até ${fmt(due)}`);
    await expect(scheduleTrigger(page.locator("tr", { hasText: entre.title }))).toHaveText(`entre ${fmt(start)} e ${fmt(due)}`);
    await expect(scheduleTrigger(page.locator("tr", { hasText: em.title }))).toHaveText(emLabel(single));
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("troca a data de 'fazer até' pelo calendário do popover", async ({ page, context }) => {
    const due = addDays(today(), 10);
    const target = sameMonth(due, 2, -2);
    const t = await createTask(s, { title: `E2E ate calendario ${s.stamp}`, scheduleMode: "ate", dueDate: ymd(due) });

    const errors = collectErrors(page);
    const row = await openList(page, context, s, t.title);
    await scheduleTrigger(row).click();
    const pop = schedulePopover(page);
    await expect(pop).toBeVisible();
    await expect(pop.getByRole("grid")).toHaveCount(1);
    await pickDay(pop, target);

    await expect.poll(async () => (await getTask(s, t.id)).dueDate?.slice(0, 10), { timeout: 15_000 }).toBe(ymd(target));
    await expect(scheduleTrigger(row)).toHaveText(`até ${fmt(target)}`);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("define prazo numa tarefa 'sem prazo': modalidade → fazer até → data", async ({ page, context }) => {
    const target = sameMonth(today(), 1, -1);
    const t = await createTask(s, { title: `E2E sem prazo ${s.stamp}` });

    const errors = collectErrors(page);
    const row = await openList(page, context, s, t.title);
    await expect(scheduleTrigger(row)).toHaveText("sem prazo");
    await scheduleTrigger(row).click();
    const pop = schedulePopover(page);
    await expect(pop).toBeVisible();
    await expect(pop.getByRole("grid")).toHaveCount(0);

    await pop.getByRole("button", { name: "sem prazo", exact: true }).click();
    await page.getByRole("button", { name: "fazer até", exact: true }).click();
    await expect(pop.getByRole("grid"), `calendário não apareceu; erros: ${errors.join(" | ") || "(nenhum)"}`).toHaveCount(1);
    await pickDay(pop, target);

    await expect
      .poll(async () => {
        const task = await getTask(s, t.id);
        return `${task.scheduleMode}|${task.dueDate?.slice(0, 10)}`;
      }, { timeout: 15_000 })
      .toBe(`ate|${ymd(target)}`);
    await expect(scheduleTrigger(row)).toHaveText(`até ${fmt(target)}`);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("'fazer entre' abre 2 calendários e edita fim e início", async ({ page, context }) => {
    const start = addDays(today(), 3);
    const due = addDays(today(), 10);
    const newDue = sameMonth(due, 2, -2);
    const newStart = sameMonth(start, 1, -1);
    const t = await createTask(s, { title: `E2E entre ${s.stamp}`, scheduleMode: "entre", startAt: ymd(start), dueDate: ymd(due) });

    const errors = collectErrors(page);
    const row = await openList(page, context, s, t.title);
    await scheduleTrigger(row).click();
    const pop = schedulePopover(page);
    await expect(pop.getByRole("grid")).toHaveCount(2);

    await pickDay(pop.locator('[data-calendar="due"]'), newDue);
    await expect.poll(async () => (await getTask(s, t.id)).dueDate?.slice(0, 10), { timeout: 15_000 }).toBe(ymd(newDue));

    await pickDay(pop.locator('[data-calendar="start"]'), newStart);
    await expect.poll(async () => (await getTask(s, t.id)).startAt?.slice(0, 10), { timeout: 15_000 }).toBe(ymd(newStart));

    await expect(scheduleTrigger(row)).toHaveText(`entre ${fmt(newStart)} e ${fmt(newDue)}`);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("atalho 'hoje' sob o calendário define a data de 'fazer em'", async ({ page, context }) => {
    const single = addDays(today(), 5);
    const t = await createTask(s, { title: `E2E em hoje ${s.stamp}`, scheduleMode: "em", dueDate: ymd(single) });

    const errors = collectErrors(page);
    const row = await openList(page, context, s, t.title);
    await scheduleTrigger(row).click();
    const pop = schedulePopover(page);
    await pop.getByRole("button", { name: "hoje", exact: true }).click();

    await expect
      .poll(async () => {
        const task = await getTask(s, t.id);
        return `${task.dueDate?.slice(0, 10)}|${task.startAt?.slice(0, 10)}`;
      }, { timeout: 15_000 })
      .toBe(`${ymd(today())}|${ymd(today())}`);
    await expect(scheduleTrigger(row)).toHaveText(emLabel(today()));
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
