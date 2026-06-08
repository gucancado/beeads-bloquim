import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

/**
 * Gate e2e do canvas ESTRATÉGICO (Fase 4). Cria workspace via API, abre a aba
 * Estratégia, e valida: canvas renderiza (lazy create), toolbar cria nó, e o nó
 * persiste após reload. Chromium real (ReactFlow).
 */
const STATE = "e2e/.auth/state.json";
let api: APIRequestContext;
let wsId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ baseURL }) => {
  api = await pwRequest.newContext({ baseURL, storageState: STATE });
  const ws = await api.post("/api/workspaces", { data: { name: `E2E Strategy ${Date.now()}` } });
  expect(ws.status(), await ws.text()).toBe(201);
  wsId = (await ws.json()).id;
});

test.afterAll(async () => {
  if (wsId) await api.delete(`/api/workspaces/${wsId}`);
  await api.dispose();
});

test("strategy canvas lazy-loads, toolbar creates a node that persists", async ({ page }) => {
  await page.goto(`/workspaces/${wsId}/strategy`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.getByRole("button", { name: "Objetivo" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  // cria um objetivo e espera o POST persistir
  const created = page.waitForResponse(
    (r) => /\/strategy\/nodes$/.test(r.url()) && r.request().method() === "POST" && r.ok(),
  );
  await page.getByRole("button", { name: "Objetivo" }).click();
  await created;
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  // persiste após reload
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});

test("inline edit of a node title autosaves and persists after reload", async ({ page }) => {
  const b = `/api/workspaces/${wsId}/strategy`;
  await api.get(b);
  const obj = await (await api.post(`${b}/nodes`, { data: { kind: "objetivo", positionX: 300, positionY: 300, data: { title: "Antigo" } } })).json();

  await page.goto(`/workspaces/${wsId}/strategy`, { waitUntil: "domcontentloaded" });
  const node = page.locator(`.react-flow__node[data-id="${obj.id}"]`);
  await expect(node).toBeVisible();
  const titleInput = node.locator('input[type="text"], input:not([type])').first();

  const patched = page.waitForResponse(
    (r) => r.url().includes(`/strategy/nodes/${obj.id}`) && r.request().method() === "PATCH" && r.ok(),
  );
  await titleInput.fill("Novo Objetivo Editado");
  await titleInput.press("Enter");
  await patched;

  await page.reload({ waitUntil: "domcontentloaded" });
  const reloaded = page.locator(`.react-flow__node[data-id="${obj.id}"] input`).first();
  await expect(reloaded).toHaveValue("Novo Objetivo Editado");
});

test("deleting a node via Delete key removes it persistently", async ({ page }) => {
  const b = `/api/workspaces/${wsId}/strategy`;
  await api.get(b);
  const tema = await (await api.post(`${b}/nodes`, { data: { kind: "tema", positionX: -250, positionY: -250, data: { title: "Tema p/ deletar" } } })).json();

  await page.goto(`/workspaces/${wsId}/strategy`, { waitUntil: "domcontentloaded" });
  const node = page.locator(`.react-flow__node[data-id="${tema.id}"]`);
  await expect(node).toBeVisible();
  // seleciona clicando no topo (rótulo do kind, fora dos inputs)
  await node.click({ position: { x: 20, y: 6 } });
  const deleted = page.waitForResponse(
    (r) => r.url().includes(`/strategy/nodes/${tema.id}`) && r.request().method() === "DELETE" && r.ok(),
  );
  await page.keyboard.press("Delete");
  await deleted;
  await expect(node).toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(`.react-flow__node[data-id="${tema.id}"]`)).toHaveCount(0);
});

test("renders edges from the graph with the prefilled relation_type label", async ({ page }) => {
  const b = `/api/workspaces/${wsId}/strategy`;
  await api.get(b); // lazy init
  const obj = await (await api.post(`${b}/nodes`, { data: { kind: "objetivo", positionX: 0, positionY: -150, data: { title: "Obj" } } })).json();
  const kr = await (await api.post(`${b}/nodes`, { data: { kind: "kr", positionX: 0, positionY: 150, data: { title: "KR", targetValue: 100 } } })).json();
  const edge = await api.post(`${b}/edges`, { data: { sourceNodeId: kr.id, targetNodeId: obj.id } });
  expect((await edge.json()).relationType).toBe("mede");

  await page.goto(`/workspaces/${wsId}/strategy`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge").getByText("mede")).toBeVisible();
});

test("strategy maps never appear in the action-plan listings (scope guard, UI)", async ({ page }) => {
  // a aba 'planos' do workspace não deve listar o map strategy
  await page.goto(`/workspaces/${wsId}`, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/);
  // não há um plano chamado "Mapa Estratégico" na lista de planos
  await expect(page.getByText("Mapa Estratégico", { exact: true })).toHaveCount(0);
});
