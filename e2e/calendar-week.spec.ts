import { test, expect, request as pwRequest, type APIRequestContext, type Page, type Locator } from "@playwright/test";

const API = process.env.API_BASE_URL ?? "http://localhost:5000";
const PASSWORD = "E2ePass12345!";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/**
 * Hoje e um dia útil futuro: amanhã, ou a segunda seguinte quando amanhã cai no
 * fim de semana (sábado/domingo vazios ficam ocultos, então não há coluna onde soltar).
 */
function days() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dow = (t.getDay() + 6) % 7; // 0 = seg
  if (dow >= 4) return { today: ymd(t), target: ymd(addDays(t, 7 - dow)), crossesWeek: true };
  return { today: ymd(t), target: ymd(addDays(t, 1)), crossesWeek: false };
}

async function api(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const r = await ctx.post("/api/auth/login", { data: { email: "e2e_tasks_owner@test.local", password: PASSWORD } });
  expect(r.ok()).toBeTruthy();
  return ctx;
}

async function dragTo(page: Page, from: Locator, to: Locator) {
  // O pool fica abaixo das colunas: sem rolar, o mouse.down cairia fora da viewport.
  await from.scrollIntoViewIfNeeded();
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const vh = page.viewportSize()!.height;
  if (!a || !b) throw new Error("sem bounding box");
  // Ponto de soltura: parte de baixo do alvo que está VISÍVEL na viewport.
  const dropY = Math.max(b.y + 40, Math.min(b.y + b.height - 12, vh - 10));
  if (dropY > vh || dropY > b.y + b.height) throw new Error("alvo fora da viewport");
  // Área neutra do card: faixa superior esquerda (acima do título).
  await page.mouse.move(a.x + 8, a.y + 6);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 20, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, dropY, { steps: 15 });
  // O dia de destino é escolhido pelo PONTEIRO: se o autoscroll do dnd-kit rolou
  // a página durante o arrasto (início perto da borda de baixo), re-mira na
  // coluna como uma pessoa faria antes de soltar. Só para alvo-coluna: num alvo
  // card, o sortable já deslocou os itens e re-mirar mudaria a posição pedida.
  const isColumn = (await to.getAttribute("data-calendar-day")) != null;
  const b2 = isColumn ? await to.boundingBox() : null;
  if (b2 && Math.abs(b2.y - b.y) > 1) {
    const y2 = Math.max(b2.y + 40, Math.min(b2.y + b2.height - 12, vh - 10));
    await page.mouse.move(b2.x + b2.width / 2, y2, { steps: 3 });
  }
  await page.mouse.up();
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("calendário: toggle, ancoragem pelo prazo, arrastar para outro dia e reordenar persistem", async ({ page, context }) => {
  const ctx = await api();
  const stamp = Date.now();
  const { today, target, crossesWeek } = days();
  const ws = await (await ctx.post("/api/workspaces", { data: { name: `E2E Calendário ${stamp}`, colorIndex: 0 } })).json();
  try {
    const mk = async (title: string, body: Record<string, unknown>) => {
      const t = await (await ctx.post(`/api/workspaces/${ws.id}/tasks`, { data: { title, ...body } })).json();
      await ctx.patch(`/api/workspaces/${ws.id}/tasks/${t.id}/status`, { data: { status: "pending" } });
      return t.id as string;
    };
    const a = await mk(`A ${stamp}`, { scheduleMode: "ate", dueDate: `${today}T12:00:00.000Z` });
    const b = await mk(`B ${stamp}`, { scheduleMode: "ate", dueDate: `${today}T12:00:00.000Z` });
    const loose = await mk(`solta ${stamp}`, {});

    await context.addCookies((await ctx.storageState()).cookies.map(c => ({ ...c, domain: "localhost" })));
    await page.goto(`/workspaces/${ws.id}?tab=tasks`);
    await page.getByRole("radio", { name: "calendário" }).click();
    const cal = page.getByTestId("week-calendar");
    await expect(cal).toBeVisible();

    const todayCol = cal.locator(`[data-calendar-day="${today}"]`);
    await expect(todayCol.locator(`[data-calendar-item="task:${a}"]`)).toBeVisible();
    await expect(todayCol.locator(`[data-calendar-item="task:${b}"]`)).toBeVisible();
    await expect(cal.locator("[data-calendar-pool]").locator(`[data-calendar-item="task:${loose}"]`)).toBeVisible();

    // reordenar: B acima de A
    await dragTo(page, todayCol.locator(`[data-calendar-item="task:${b}"]`), todayCol.locator(`[data-calendar-item="task:${a}"]`));
    await expect.poll(async () => {
      const rows = await (await ctx.get(`/api/calendar/tasks?from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}&workspaceId=${ws.id}&assignedTo=`)).json();
      const ra = rows.find((r: any) => r.id === a);
      const rb = rows.find((r: any) => r.id === b);
      return rb?.plannedOrder != null && ra?.plannedOrder != null && rb.plannedOrder < ra.plannedOrder;
    }).toBe(true);

    // arrastar a solta para o dia alvo
    if (crossesWeek) await cal.getByRole("button", { name: "próxima semana" }).click();
    const targetCol = cal.locator(`[data-calendar-day="${target}"]`);
    await dragTo(page, cal.locator(`[data-calendar-item="task:${loose}"]`), targetCol);
    await expect(targetCol.locator(`[data-calendar-item="task:${loose}"]`)).toBeVisible();

    await page.reload();
    await page.getByRole("radio", { name: "calendário" }).click();
    if (crossesWeek) await page.getByRole("button", { name: "próxima semana" }).click();
    await expect(page.locator(`[data-calendar-day="${target}"] [data-calendar-item="task:${loose}"]`)).toBeVisible();
    const order = await page.locator(`[data-calendar-day="${today}"] [data-calendar-item]`).evaluateAll(els => els.map(e => e.getAttribute("data-calendar-item")));
    expect(order.indexOf(`task:${b}`)).toBeLessThan(order.indexOf(`task:${a}`));
  } finally {
    await ctx.delete(`/api/workspaces/${ws.id}`);
  }
});

test("calendário: urgente → 'fazer até' sem data não desmonta o card no meio da edição", async ({ page, context }) => {
  const ctx = await api();
  const stamp = Date.now();
  const { today } = days();
  const ws = await (await ctx.post("/api/workspaces", { data: { name: `E2E Calendário U ${stamp}`, colorIndex: 0 } })).json();
  try {
    const t = await (await ctx.post(`/api/workspaces/${ws.id}/tasks`, { data: { title: `U ${stamp}`, scheduleMode: "urgente" } })).json();
    await ctx.patch(`/api/workspaces/${ws.id}/tasks/${t.id}/status`, { data: { status: "pending" } });
    await context.addCookies((await ctx.storageState()).cookies.map(c => ({ ...c, domain: "localhost" })));
    await page.goto(`/workspaces/${ws.id}?tab=tasks`);
    await page.getByRole("radio", { name: "calendário" }).click();
    const card = page.locator(`[data-calendar-day="${today}"] [data-calendar-item="task:${t.id}"]`);
    await expect(card).toBeVisible();
    await card.getByTitle("Clique para alterar modalidade de prazo").click();
    await card.getByTitle("Modalidade do fazer").selectOption("ate");
    await page.waitForTimeout(2500); // janela em que o refetch arrancaria o card
    await expect(card.getByTitle("Modalidade do fazer")).toBeVisible();
  } finally {
    await ctx.delete(`/api/workspaces/${ws.id}`);
  }
});
