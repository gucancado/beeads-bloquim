import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * Smoke de UI dos modelos (branch feat/modelos-de-plano):
 *  - menu "modelo" do modal de tarefa (aplicar / criar), inclusive no /embed/task;
 *  - botão "modelos de plano de ação" do canvas (criar do mapa / da seleção, aplicar);
 *  - /my-templates com as abas "tarefas" / "planos de ação".
 *
 * Setup por API, asserções na UI. Cada teste cria o próprio workspace
 * `E2E Modelos <stamp>` e apaga no fim, junto com os modelos que criou
 * (modelos são por usuário e não morrem com o workspace).
 */

const API = process.env.API_BASE_URL ?? "http://localhost:5000";
const PASSWORD = "E2ePass12345!";
const OWNER = "e2e_tasks_owner@test.local";
const MATE = "e2e_tasks_mate@test.local";
const FATAL = /ReferenceError|TypeError|unhandled error/i;

type User = { id: string };
type Cleanup = { taskTemplates: string[]; planTemplates: string[] };

async function login(email: string): Promise<{ api: APIRequestContext; user: User }> {
  const api = await pwRequest.newContext({ baseURL: API });
  const res = await api.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(res.ok(), `login ${email}: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  return { api, user: (body.user ?? body) as User };
}

async function ok<T = any>(p: Promise<import("@playwright/test").APIResponse>, what: string): Promise<T> {
  const r = await p;
  const text = await r.text();
  expect(r.ok(), `${what}: ${r.status()} ${text}`).toBeTruthy();
  return (text ? JSON.parse(text) : null) as T;
}

async function authenticate(context: BrowserContext, api: APIRequestContext) {
  const state = await api.storageState();
  await context.addCookies(state.cookies.map((c) => ({ ...c, domain: "localhost", path: "/", secure: false })));
}

/** Coleta erros fatais (pageerror + console.error com cara de bug de JS). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && FATAL.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function newWorkspace(api: APIRequestContext, stamp: number) {
  const ws = await ok(api.post("/api/workspaces", { data: { name: `E2E Modelos ${stamp}`, colorIndex: 0 } }), "workspace");
  const mapName = `plano e2e ${stamp}`;
  const map = await ok(api.post(`/api/workspaces/${ws.id}/maps`, { data: { name: mapName } }), "map");
  return { wsId: ws.id as string, mapId: map.id as string, mapName };
}

async function newCard(api: APIRequestContext, wsId: string, mapId: string, title: string, x: number, y: number) {
  const card = await ok(
    api.post(`/api/workspaces/${wsId}/maps/${mapId}/cards`, { data: { title, positionX: x, positionY: y } }),
    "card",
  );
  expect(card.taskId).toBeTruthy();
  return card as { id: string; taskId: string };
}

async function addMate(api: APIRequestContext, wsId: string, role: "editor" | "executor") {
  await ok(api.post(`/api/workspaces/${wsId}/members`, { data: { email: MATE, role } }), "member");
}

async function getMap(api: APIRequestContext, wsId: string, mapId: string) {
  return ok(api.get(`/api/workspaces/${wsId}/maps/${mapId}`), "get map");
}

async function cleanup(api: APIRequestContext, wsId: string | undefined, c: Cleanup) {
  for (const id of c.planTemplates) await api.delete(`/api/plan-templates/${id}`);
  for (const id of c.taskTemplates) await api.delete(`/api/task-templates/${id}`);
  if (wsId) await api.delete(`/api/workspaces/${wsId}`);
  await api.dispose();
}

const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function openCanvas(page: Page, wsId: string, mapId: string, query = "") {
  await page.goto(`/workspaces/${wsId}/maps/${mapId}${query}`);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

/** Clique "seco" no card: borda esquerda, meia altura, longe de título/status/prazo. */
async function selectNode(page: Page, id: string) {
  const box = (await node(page, id).boundingBox())!;
  await node(page, id).click({ position: { x: 6, y: Math.round(box.height / 2) } });
  await expect(node(page, id)).toHaveClass(/\bselected\b/);
}

/**
 * Clica num ponto vazio do pane (desfaz a seleção). O canvas já abre com o
 * card de foco selecionado, então "sem seleção" exige isso.
 */
async function clickEmptyPane(page: Page) {
  const pt = await page.evaluate(() => {
    for (let y = 120; y < window.innerHeight - 120; y += 20) {
      for (let x = 320; x < window.innerWidth - 20; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el && el.classList.contains("react-flow__pane")) return { x, y };
      }
    }
    return null;
  });
  expect(pt, "nenhum ponto vazio no pane").not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
}

async function openPlanMenu(page: Page) {
  await page.getByTitle("modelos de plano de ação", { exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

// ───────────────────────────── 1–4: modal de tarefa ─────────────────────────────

test("modal de tarefa: menu modelo (criar e aplicar), rascunho e não-rascunho", async ({ page, context }) => {
  const errors = watchErrors(page);
  const stamp = Date.now();
  const { api } = await login(OWNER);
  const c: Cleanup = { taskTemplates: [], planTemplates: [] };
  let wsId: string | undefined;
  try {
    const s = await newWorkspace(api, stamp);
    wsId = s.wsId;
    const titleA = `rascunho ${stamp}`;
    const titleB = `pronta ${stamp}`;
    const a = await newCard(api, s.wsId, s.mapId, titleA, 100, 100);
    const b = await newCard(api, s.wsId, s.mapId, titleB, 500, 100);
    await ok(
      api.patch(`/api/workspaces/${s.wsId}/tasks/${a.taskId}`, { data: { description: `descrição ${stamp}`, priority: "high" } }),
      "patch A",
    );
    await ok(
      api.post(`/api/workspaces/${s.wsId}/tasks/${a.taskId}/subtasks`, { data: { items: [{ text: "item 1" }, { text: "item 2" }] } }),
      "subtasks A",
    );
    await ok(api.patch(`/api/workspaces/${s.wsId}/tasks/${b.taskId}/status`, { data: { status: "pending" } }), "status B");

    await authenticate(context, api);

    // 1. rascunho: botão "modelo" abre menu com os dois itens
    await openCanvas(page, s.wsId, s.mapId, `?cardId=${a.id}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTitle("modelo", { exact: true }).click();
    const applyItem = page.getByRole("button", { name: "aplicar modelo", exact: true });
    const createItem = page.getByRole("button", { name: "criar modelo", exact: true });
    await expect(applyItem).toBeVisible();
    await expect(createItem).toBeVisible();
    await expect(applyItem).toHaveAttribute("aria-disabled", "false");

    // 2. criar modelo → toast + conteúdo do modelo
    const createdA = page.waitForResponse((r) => r.url().endsWith("/api/task-templates/from-task") && r.request().method() === "POST");
    await createItem.click();
    const tplA = await (await createdA).json();
    c.taskTemplates.push(tplA.id);
    await expect(toast(page, "novo modelo de tarefa criado")).toBeVisible();
    const fullA = await ok(api.get(`/api/task-templates/${tplA.id}`), "get template A");
    expect(fullA.name).toBe(titleA);
    expect(fullA.description).toContain(`descrição ${stamp}`);
    expect(fullA.priority).toBe("high");
    expect((fullA.subtasks as Array<{ title: string }>).map((x) => x.title)).toEqual(["item 1", "item 2"]);

    // 3. não-rascunho: botão habilitado, "aplicar" acinzentado com dica, "criar" funciona
    await openCanvas(page, s.wsId, s.mapId, `?cardId=${b.id}`);
    await expect(page.getByRole("dialog")).toBeVisible();
    const btnB = page.getByRole("dialog").getByTitle("modelo", { exact: true });
    await expect(btnB).toBeEnabled();
    await btnB.click();
    await expect(applyItem).toHaveAttribute("aria-disabled", "true");
    await expect(applyItem).toHaveAttribute("title", "só é possível aplicar modelo em tarefas em rascunho");
    await applyItem.click({ force: true }); // aria-disabled: o clique não pode abrir a lista
    await expect(createItem).toBeVisible(); // continua no menu (não abriu a lista)
    const createdB = page.waitForResponse((r) => r.url().endsWith("/api/task-templates/from-task") && r.request().method() === "POST");
    await createItem.click();
    const tplB = await (await createdB).json();
    c.taskTemplates.push(tplB.id);
    expect((await createdB).ok()).toBeTruthy();
    await expect(toast(page, "novo modelo de tarefa criado")).toHaveCount(1);

    // 4. aplicar modelo (fluxo antigo): lista → escolher → confirmação → toast
    await openCanvas(page, s.wsId, s.mapId, `?cardId=${a.id}`);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByTitle("modelo", { exact: true }).click();
    await applyItem.click();
    await page.getByRole("button", { name: titleA, exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Aplicar modelo?");
    const applied = page.waitForResponse((r) => r.url().endsWith(`/api/task-templates/${tplA.id}/apply`));
    await confirm.getByRole("button", { name: "Aplicar" }).click();
    expect((await applied).ok()).toBeTruthy();
    await expect(toast(page, "modelo aplicado")).toBeVisible();
    const subs = await ok(api.get(`/api/workspaces/${s.wsId}/tasks/${a.taskId}/subtasks`), "subtasks after apply");
    expect((subs as unknown[]).length).toBe(4);

    // 2 (cont.). aparece em /my-templates, aba "tarefas"
    await page.goto("/my-templates");
    await expect(page.getByRole("tab", { name: "tarefas" })).toBeVisible();
    await expect(page.getByText(titleA, { exact: true })).toBeVisible();
    await expect(page.getByText(titleB, { exact: true })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await cleanup(api, wsId, c);
  }
});

// ───────────────────────────── 5: /embed/task ─────────────────────────────

test("embed /embed/task: menu modelo abre dentro do modal e cria modelo", async ({ page, context }) => {
  const errors = watchErrors(page);
  const stamp = Date.now();
  const { api } = await login(OWNER);
  const c: Cleanup = { taskTemplates: [], planTemplates: [] };
  let wsId: string | undefined;
  try {
    const s = await newWorkspace(api, stamp);
    wsId = s.wsId;
    const card = await newCard(api, s.wsId, s.mapId, `embed ${stamp}`, 100, 100);

    // Harness do painel: a página-pai é servida numa rota interceptada com a
    // origem da allowlist do build de prod (https://painel.beeads.com.br). O
    // iframe também precisa de origem "pública" (o Chrome bloqueia público →
    // localhost por Private Network Access), então o app é servido em
    // https://bloquim.beeads.com.br por proxy pra WEB_BASE_URL — mesmo site do
    // painel, como em prod, e o cookie Lax vai junto.
    const web = new URL(process.env.WEB_BASE_URL ?? "http://localhost:3100").origin;
    const APP = "https://bloquim.beeads.com.br";
    const state = await api.storageState();
    await context.addCookies(
      state.cookies.map((ck) => ({ ...ck, domain: "bloquim.beeads.com.br", path: "/", secure: true })),
    );
    await context.route(`${APP}/**`, async (route) => {
      const u = new URL(route.request().url());
      const resp = await route.fetch({ url: web + u.pathname + u.search });
      await route.fulfill({ response: resp });
    });
    await context.route("https://painel.beeads.com.br/harness", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body style="margin:0">
<iframe id="f" src="${APP}/embed/task" style="border:0;width:1200px;height:800px"></iframe>
<script>
  window.addEventListener("message", (e) => {
    if (e.data && e.data.source === "bloquim-embed" && e.data.type === "ready") {
      document.getElementById("f").contentWindow.postMessage(
        { source: "bcd-panel", type: "open", workspaceId: ${JSON.stringify(s.wsId)}, taskId: ${JSON.stringify(card.taskId)} },
        ${JSON.stringify(APP)});
    }
  });
</script></body></html>`,
      }),
    );
    await page.goto("https://painel.beeads.com.br/harness");
    const frame = page.frameLocator("#f");
    const dialog = frame.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("input, textarea").first()).toBeVisible();
    await dialog.getByTitle("modelo", { exact: true }).click();
    const createItem = frame.getByRole("button", { name: "criar modelo", exact: true });
    await expect(createItem).toBeVisible();
    await expect(frame.getByRole("button", { name: "aplicar modelo", exact: true })).toBeVisible();

    // posicionado dentro do modal (portal no container do Dialog)
    const dlgBox = (await dialog.boundingBox())!;
    const itemBox = (await createItem.boundingBox())!;
    expect(itemBox.x).toBeGreaterThanOrEqual(dlgBox.x - 1);
    expect(itemBox.y).toBeGreaterThanOrEqual(dlgBox.y - 1);
    expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(dlgBox.x + dlgBox.width + 1);
    expect(itemBox.y + itemBox.height).toBeLessThanOrEqual(dlgBox.y + dlgBox.height + 1);

    const created = page.waitForResponse((r) => r.url().endsWith("/api/task-templates/from-task") && r.request().method() === "POST");
    await createItem.click();
    const tpl = await (await created).json();
    c.taskTemplates.push(tpl.id);
    await expect(frame.locator("[data-sonner-toast]").filter({ hasText: "novo modelo de tarefa criado" })).toBeVisible();
    expect(tpl.name).toBe(`embed ${stamp}`);

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await cleanup(api, wsId, c);
  }
});

// ───────────────────────────── 6: botão do canvas e itens por seleção ─────────────────────────────

test("canvas: botão de modelos de plano ao lado da busca e itens conforme a seleção", async ({ page, context }) => {
  const errors = watchErrors(page);
  const stamp = Date.now();
  const { api } = await login(OWNER);
  const { user: mate } = await login(MATE);
  const c: Cleanup = { taskTemplates: [], planTemplates: [] };
  let wsId: string | undefined;
  try {
    const s = await newWorkspace(api, stamp);
    wsId = s.wsId;
    await addMate(api, s.wsId, "editor");
    const card = await newCard(api, s.wsId, s.mapId, `card ${stamp}`, 100, 100);
    await ok(api.post(`/api/workspaces/${s.wsId}/tasks/${card.taskId}/approvals`, { data: { approverId: mate.id } }), "approval");
    const map = await getMap(api, s.wsId, s.mapId);
    const approval = (map.cards as any[]).find((x) => x.isApprovalTask || x.taskIsApprovalTask);
    expect(approval, JSON.stringify(map.cards)).toBeTruthy();

    await authenticate(context, api);
    await openCanvas(page, s.wsId, s.mapId);
    await expect(page.locator(".react-flow__node-approvalnode")).toBeVisible();

    // mesmo estilo/tamanho e à esquerda da busca, na mesma linha
    const btn = page.getByTitle("modelos de plano de ação", { exact: true });
    const search = page.getByTitle("buscar tarefas (Ctrl+F)");
    const bb = (await btn.boundingBox())!;
    const sb = (await search.boundingBox())!;
    expect(bb.x + bb.width).toBeLessThanOrEqual(sb.x);
    expect(Math.abs(bb.y - sb.y)).toBeLessThanOrEqual(2);
    expect(Math.round(bb.width)).toBe(Math.round(sb.width));
    expect(Math.round(bb.height)).toBe(Math.round(sb.height));

    // sem seleção → 2 itens
    await clickEmptyPane(page);
    let menu = await openPlanMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveText(["aplicar modelo de plano de ação", "criar modelo de plano de ação"]);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // um card selecionado → 3 itens
    await selectNode(page, card.id);
    menu = await openPlanMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveText([
      "aplicar modelo de plano de ação",
      "criar modelo de plano de ação",
      "criar modelo a partir da seleção",
    ]);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // só a aprovação selecionada → 2 itens
    await selectNode(page, approval.id);
    await expect(node(page, card.id)).not.toHaveClass(/\bselected\b/);
    menu = await openPlanMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    await page.keyboard.press("Escape");

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await cleanup(api, wsId, c);
  }
});

// ───────────────────────────── 7–8: capturar mapa / seleção ─────────────────────────────

test("canvas: criar modelo do mapa (aprovação e imagem de fora) e da seleção", async ({ page, context }) => {
  const errors = watchErrors(page);
  const stamp = Date.now();
  const { api } = await login(OWNER);
  const { user: mate } = await login(MATE);
  const c: Cleanup = { taskTemplates: [], planTemplates: [] };
  let wsId: string | undefined;
  try {
    const s = await newWorkspace(api, stamp);
    wsId = s.wsId;
    await addMate(api, s.wsId, "editor");
    const card = await newCard(api, s.wsId, s.mapId, `card ${stamp}`, 100, 100);
    await newCard(api, s.wsId, s.mapId, `outro ${stamp}`, 500, 100);
    await ok(api.post(`/api/workspaces/${s.wsId}/tasks/${card.taskId}/approvals`, { data: { approverId: mate.id } }), "approval");

    // forma-imagem: precisa de um attachment ancorado no mapa (a linha basta;
    // o upload do binário não é necessário pra captura, que só conta e pula).
    const upload = await ok(
      api.post("/api/storage/uploads/request-url", {
        data: {
          bucket: "attachments",
          entityKind: "map",
          entityId: s.mapId,
          filename: "e2e.png",
          contentType: "image/png",
          sizeBytes: 68,
        },
      }),
      "request-url",
    );
    const attachmentId = upload.attachmentId ?? upload.attachment?.id ?? upload.id;
    expect(attachmentId, JSON.stringify(upload)).toBeTruthy();
    await ok(
      api.post(`/api/workspaces/${s.wsId}/maps/${s.mapId}/shapes`, {
        data: { type: "image", positionX: 100, positionY: 600, width: 120, height: 120, attachmentId },
      }),
      "image shape",
    );

    await authenticate(context, api);
    await openCanvas(page, s.wsId, s.mapId);
    await expect(page.locator(".react-flow__node-approvalnode")).toBeVisible();

    // 7. mapa inteiro
    await clickEmptyPane(page);
    let menu = await openPlanMenu(page);
    const captured = page.waitForResponse((r) => r.url().endsWith("/plan-templates/capture") && r.request().method() === "POST");
    await menu.getByRole("menuitem", { name: "criar modelo de plano de ação", exact: true }).click();
    const full = await (await captured).json();
    c.planTemplates.push(full.template.id);
    expect(full.skipped).toEqual({ approvals: 1, images: 1 });
    expect(full.template.name).toBe(s.mapName);
    const t1 = toast(page, "novo modelo de plano de ação criado");
    await expect(t1).toBeVisible();
    await expect(t1).toContainText("1 aprovação e 1 imagem ficaram de fora");

    // 8. a partir da seleção
    await selectNode(page, card.id);
    menu = await openPlanMenu(page);
    const capturedSel = page.waitForResponse((r) => r.url().endsWith("/plan-templates/capture") && r.request().method() === "POST");
    await menu.getByRole("menuitem", { name: "criar modelo a partir da seleção", exact: true }).click();
    const sel = await (await capturedSel).json();
    c.planTemplates.push(sel.template.id);
    expect(sel.template.name).toBe(`${s.mapName} (seleção)`);
    expect(sel.template.counts.cards).toBe(1);

    await page.goto("/my-templates");
    await page.getByRole("tab", { name: "planos de ação" }).click();
    const inputs = page.getByLabel("nome do modelo de plano");
    await expect.poll(() => inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(
      expect.arrayContaining([s.mapName, `${s.mapName} (seleção)`]),
    );

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await cleanup(api, wsId, c);
  }
});

// ───────────────────────────── 9: aplicar ─────────────────────────────

test("canvas: aplicar modelo de plano posiciona à direita, enquadra e seleciona os novos", async ({ page, context }) => {
  const errors = watchErrors(page);
  const stamp = Date.now();
  const { api } = await login(OWNER);
  const c: Cleanup = { taskTemplates: [], planTemplates: [] };
  let wsId: string | undefined;
  try {
    const s = await newWorkspace(api, stamp);
    wsId = s.wsId;
    const a = await newCard(api, s.wsId, s.mapId, `a ${stamp}`, 100, 100);
    const b = await newCard(api, s.wsId, s.mapId, `b ${stamp}`, 400, 300);
    await ok(
      api.post(`/api/workspaces/${s.wsId}/maps/${s.mapId}/connections`, {
        data: { sourceCardId: a.id, targetCardId: b.id },
      }),
      "connection",
    );
    const cap = await ok(api.post(`/api/workspaces/${s.wsId}/maps/${s.mapId}/plan-templates/capture`, { data: {} }), "capture");
    c.planTemplates.push(cap.template.id);

    const before = await getMap(api, s.wsId, s.mapId);
    const oldPos = new Map((before.cards as any[]).map((x) => [x.id, [x.positionX, x.positionY]]));
    const oldMaxRight = Math.max(...(before.cards as any[]).map((x) => x.positionX + 200)); // NODE_WIDTH

    await authenticate(context, api);
    await openCanvas(page, s.wsId, s.mapId);
    await selectNode(page, a.id); // um card antigo selecionado: tem de ficar desmarcado após aplicar

    const menu = await openPlanMenu(page);
    await menu.getByRole("menuitem", { name: "aplicar modelo de plano de ação", exact: true }).click();
    const applied = page.waitForResponse((r) => r.url().includes(`/plan-templates/${cap.template.id}/apply`));
    await page.getByRole("menuitem", { name: s.mapName, exact: true }).click();
    const res = await (await applied).json();
    expect(res.cardIds).toHaveLength(2);
    expect(res.connectionIds).toHaveLength(1);
    await expect(toast(page, "modelo de plano de ação aplicado")).toBeVisible();

    // posições (API)
    const after = await getMap(api, s.wsId, s.mapId);
    const newCards = (after.cards as any[]).filter((x) => res.cardIds.includes(x.id));
    expect(newCards).toHaveLength(2);
    for (const nc of newCards) expect(nc.positionX).toBeGreaterThanOrEqual(oldMaxRight + 120);
    for (const [id, [x, y]] of oldPos) {
      const now = (after.cards as any[]).find((k) => k.id === id);
      expect([now.positionX, now.positionY]).toEqual([x, y]);
    }

    // seleção: novos selecionados, antigos não
    for (const id of res.cardIds) await expect(node(page, id)).toHaveClass(/\bselected\b/);
    await expect(node(page, a.id)).not.toHaveClass(/\bselected\b/);
    await expect(node(page, b.id)).not.toHaveClass(/\bselected\b/);

    // enquadramento: os novos cabem na viewport
    await page.waitForTimeout(600); // animação do fitBounds (400ms)
    const vp = page.viewportSize()!;
    for (const id of res.cardIds) {
      const box = (await node(page, id).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    }

    // Delete abre o diálogo de exclusão para os 2 novos
    await page.locator(".react-flow__pane").focus().catch(() => undefined);
    await page.keyboard.press("Delete");
    const del = page.getByRole("alertdialog");
    await expect(del).toContainText("excluir 2 tarefas?");
    await del.getByRole("button", { name: "cancelar" }).click();
    await expect(del).toBeHidden();

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await cleanup(api, wsId, c);
  }
});

// ───────────────────────────── 10: executor ─────────────────────────────

test("canvas: executor não pode aplicar modelo de plano (403 com toast)", async ({ page, context }) => {
  const errors = watchErrors(page);
  const stamp = Date.now();
  const { api } = await login(OWNER);
  const mateSession = await login(MATE);
  const mateApi = mateSession.api;
  const c: Cleanup = { taskTemplates: [], planTemplates: [] };
  const mateTemplates: string[] = [];
  let wsId: string | undefined;
  try {
    const s = await newWorkspace(api, stamp);
    wsId = s.wsId;
    await addMate(api, s.wsId, "executor");
    await newCard(api, s.wsId, s.mapId, `card ${stamp}`, 100, 100);
    // Modelos são por usuário: o executor captura o próprio (capture aceita executor).
    const cap = await ok(mateApi.post(`/api/workspaces/${s.wsId}/maps/${s.mapId}/plan-templates/capture`, { data: {} }), "mate capture");
    mateTemplates.push(cap.template.id);
    const cardsBefore = (await getMap(api, s.wsId, s.mapId)).cards.length;

    await authenticate(context, mateApi);
    await openCanvas(page, s.wsId, s.mapId);
    const menu = await openPlanMenu(page);
    await menu.getByRole("menuitem", { name: "aplicar modelo de plano de ação", exact: true }).click();
    const applied = page.waitForResponse((r) => r.url().includes(`/plan-templates/${cap.template.id}/apply`));
    await page.getByRole("menuitem", { name: s.mapName, exact: true }).click();
    expect((await applied).status()).toBe(403);
    await expect(toast(page, "você não tem permissão pra aplicar modelos neste plano")).toBeVisible();
    expect((await getMap(api, s.wsId, s.mapId)).cards.length).toBe(cardsBefore);

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    for (const id of mateTemplates) await mateApi.delete(`/api/plan-templates/${id}`);
    await mateApi.dispose();
    await cleanup(api, wsId, c);
  }
});

// ───────────────────────────── 11: /my-templates ─────────────────────────────

test("/my-templates: menu modelos, abas, renomear, excluir e estado vazio", async ({ page, context, browser }) => {
  const errors = watchErrors(page);
  const stamp = Date.now();
  const { api } = await login(OWNER);
  const c: Cleanup = { taskTemplates: [], planTemplates: [] };
  let wsId: string | undefined;
  try {
    const s = await newWorkspace(api, stamp);
    wsId = s.wsId;
    await newCard(api, s.wsId, s.mapId, `card ${stamp}`, 100, 100);
    const cap = await ok(api.post(`/api/workspaces/${s.wsId}/maps/${s.mapId}/plan-templates/capture`, { data: {} }), "capture");
    const id = cap.template.id as string;
    c.planTemplates.push(id);
    const nameOf = async () => {
      const list = await ok<any[]>(api.get("/api/plan-templates"), "list");
      return list.find((t) => t.id === id)?.name;
    };

    await authenticate(context, api);
    await page.goto("/my-tasks");
    await page.getByRole("button", { name: "configurações" }).click();
    await page.getByRole("menuitem", { name: "modelos" }).click();
    await expect(page).toHaveURL(/\/my-templates$/);
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toHaveText("modelos");
    await expect(page.getByRole("tab", { name: "tarefas" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "planos de ação" })).toBeVisible();

    const inputs = page.getByLabel("nome do modelo de plano");
    const rowInput = async (value: string) => {
      await expect.poll(() => inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toContain(value);
      const values = await inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      return inputs.nth(values.indexOf(value));
    };
    const patchDone = () => page.waitForResponse((r) => r.url().endsWith(`/api/plan-templates/${id}`) && r.request().method() === "PATCH");
    const openTab = async () => {
      await page.getByRole("tab", { name: "planos de ação" }).click();
    };

    await openTab();
    // renomear no blur
    let input = await rowInput(s.mapName);
    await input.fill(`blur ${stamp}`);
    let saved = patchDone();
    await page.getByRole("tab", { name: "planos de ação" }).click(); // tira o foco
    expect((await saved).ok()).toBeTruthy();
    await page.reload();
    await openTab();
    input = await rowInput(`blur ${stamp}`);

    // renomear com Enter
    await input.fill(`enter ${stamp}`);
    saved = patchDone();
    await input.press("Enter");
    expect((await saved).ok()).toBeTruthy();
    await page.reload();
    await openTab();
    input = await rowInput(`enter ${stamp}`);
    expect(await nameOf()).toBe(`enter ${stamp}`);

    // nome vazio restaura o anterior (sem PATCH)
    let patched = false;
    const onReq = (r: import("@playwright/test").Request) => {
      if (r.method() === "PATCH" && r.url().endsWith(`/api/plan-templates/${id}`)) patched = true;
    };
    page.on("request", onReq);
    await input.fill("");
    await input.press("Enter");
    await expect(input).toHaveValue(`enter ${stamp}`);
    await page.waitForTimeout(500);
    page.off("request", onReq);
    expect(patched).toBe(false);
    expect(await nameOf()).toBe(`enter ${stamp}`);

    // excluir
    const values = await inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const idx = values.indexOf(`enter ${stamp}`);
    const tabPanel = page.getByRole("tabpanel");
    await tabPanel.getByTitle("excluir modelo").nth(idx).click();
    const dlg = page.getByRole("alertdialog");
    await expect(dlg).toContainText("Excluir modelo de plano?");
    const deleted = page.waitForResponse((r) => r.url().endsWith(`/api/plan-templates/${id}`) && r.request().method() === "DELETE");
    await dlg.getByRole("button", { name: "Excluir" }).click();
    expect((await deleted).ok()).toBeTruthy();
    await expect.poll(() => inputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).not.toContain(`enter ${stamp}`);
    expect(await nameOf()).toBeUndefined();
    c.planTemplates = [];

    // estado vazio: usuário e2e "mate" sem modelos de plano (limpa sobras de execuções anteriores)
    const mate = await login(MATE);
    try {
      for (const t of await ok<any[]>(mate.api.get("/api/plan-templates"), "mate list")) {
        await mate.api.delete(`/api/plan-templates/${t.id}`);
      }
      const ctx2 = await browser.newContext();
      try {
        await authenticate(ctx2, mate.api);
        const p2 = await ctx2.newPage();
        const errors2 = watchErrors(p2);
        await p2.goto("/my-templates");
        await p2.getByRole("tab", { name: "planos de ação" }).click();
        await expect(
          p2.getByText("você ainda não tem modelos de plano de ação. crie um a partir de um plano no mapa."),
        ).toBeVisible();
        expect(errors2, errors2.join("\n")).toEqual([]);
      } finally {
        await ctx2.close();
      }
    } finally {
      await mate.api.dispose();
    }

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await cleanup(api, wsId, c);
  }
});
