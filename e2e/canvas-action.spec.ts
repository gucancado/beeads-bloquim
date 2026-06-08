import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Gate e2e do canvas do plano de ação (substitui o checklist manual 0.2).
 * Roda contra um chromium real — ReactFlow precisa de DOM de verdade.
 * Cada describe cria seu próprio workspace+map via API e limpa no fim.
 * Verifica as superfícies que a extração do CanvasBase toca: render, toolbar
 * (criar nó), camadas formas/texto, viewport (zoom/fit), drag de nó, deleção,
 * e PERSISTÊNCIA após reload.
 */

const STATE = "e2e/.auth/state.json";
const TAREFA = '[title="Clique para adicionar tarefa no centro • Arraste para posicionar"]';
const TEXTO = '[title="Clique para adicionar texto no centro • Arraste para posicionar"]';

let api: APIRequestContext;
let wsId: string;
let mapId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ baseURL }) => {
  api = await pwRequest.newContext({ baseURL, storageState: STATE });
  const ws = await api.post("/api/workspaces", { data: { name: `E2E Canvas ${Date.now()}` } });
  expect(ws.status(), await ws.text()).toBe(201);
  wsId = (await ws.json()).id;
  const map = await api.post(`/api/workspaces/${wsId}/maps`, { data: { name: "Gate Map" } });
  expect(map.status(), await map.text()).toBe(201);
  mapId = (await map.json()).id;
});

test.afterAll(async () => {
  if (wsId) await api.delete(`/api/workspaces/${wsId}`);
  await api.dispose();
});

async function openCanvas(page: Page) {
  await page.goto(`/workspaces/${wsId}/maps/${mapId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow")).toBeVisible();
  // espera a toolbar (canvas montado)
  await expect(page.locator(TAREFA)).toBeVisible();
}

test("canvas renders empty with toolbar + zoom controls", async ({ page }) => {
  await openCanvas(page);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await expect(page.locator('[title="aproximar"]')).toBeVisible();
  await expect(page.locator('[title="enquadrar"]')).toBeVisible();
});

test("toolbar creates a card node that persists after reload", async ({ page }) => {
  await openCanvas(page);
  await page.locator(TAREFA).click();
  await expect(page.locator(".react-flow__node-mindmap")).toHaveCount(1);

  // persiste após reload
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node-mindmap")).toHaveCount(1);
});

test("toolbar creates a text node that persists after reload", async ({ page }) => {
  await openCanvas(page);
  const before = await page.locator(".react-flow__node-textnode").count();
  await page.locator(TEXTO).click();
  await expect(page.locator(".react-flow__node-textnode")).toHaveCount(before + 1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node-textnode")).toHaveCount(before + 1);
});

test("shape tool draws a rectangle that persists after reload", async ({ page }) => {
  await openCanvas(page);
  const before = await page.locator(".react-flow__node-shapenode").count();
  await page.getByRole("button", { name: "Forma" }).click();
  await page.getByRole("button", { name: "retângulo" }).click();
  // desenha arrastando no overlay do canvas
  const flow = page.locator(".react-flow");
  const box = (await flow.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__node-shapenode")).toHaveCount(before + 1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node-shapenode")).toHaveCount(before + 1);
});

test("zoom controls change the viewport transform", async ({ page }) => {
  await openCanvas(page);
  const vp = page.locator(".react-flow__viewport");
  const before = await vp.getAttribute("style");
  // "afastar" (zoom out) sempre reduz — fitView de mapa pequeno já fica no
  // zoom máximo, então "aproximar" pode não ter pra onde ir.
  await page.locator('[title="afastar"]').click();
  await expect(async () => {
    expect(await vp.getAttribute("style")).not.toBe(before);
  }).toPass({ timeout: 10_000 });
});

test("dragging a node persists its new position after reload", async ({ page }) => {
  await openCanvas(page);
  // garante ao menos um card
  if ((await page.locator(".react-flow__node-mindmap").count()) === 0) {
    await page.locator(TAREFA).click();
    await expect(page.locator(".react-flow__node-mindmap")).toHaveCount(1);
  }
  const node = page.locator(".react-flow__node-mindmap").first();
  const b1 = (await node.boundingBox())!;
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.mouse.down();
  await page.mouse.move(b1.x + b1.width / 2 + 120, b1.y + b1.height / 2 + 90, { steps: 10 });
  await page.mouse.up();

  await page.reload({ waitUntil: "domcontentloaded" });
  const moved = page.locator(".react-flow__node-mindmap").first();
  const b2 = (await moved.boundingBox())!;
  // posição mudou de forma persistente (tolerância p/ zoom/render)
  expect(Math.abs(b2.x - b1.x) + Math.abs(b2.y - b1.y)).toBeGreaterThan(30);
});

test("deleting a card via Delete key + confirm removes it persistently", async ({ page }) => {
  // Map dedicado → estado determinístico (0 cards), sem leftovers de outros testes.
  const m = await api.post(`/api/workspaces/${wsId}/maps`, { data: { name: "Del Map" } });
  expect(m.status()).toBe(201);
  const delMapId = (await m.json()).id as string;
  await page.goto(`/workspaces/${wsId}/maps/${delMapId}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(TAREFA)).toBeVisible();
  await expect(page.locator(".react-flow__node-mindmap")).toHaveCount(0);

  // cria o card e espera o POST + reconciliação do id real (networkidle) antes
  // de deletar — senão o delete pode mirar o id otimista e virar no-op.
  const created = page.waitForResponse(
    (r) => /\/cards$/.test(r.url()) && r.request().method() === "POST" && r.ok(),
  );
  await page.locator(TAREFA).click();
  await created;
  await expect(page.locator(".react-flow__node-mindmap")).toHaveCount(1);
  await page.waitForLoadState("networkidle");

  await page.locator(".react-flow__node-mindmap").first().click(); // seleciona
  await page.keyboard.press("Delete");
  const deleted = page.waitForResponse(
    (r) => /\/cards\/[^/]+$/.test(r.url()) && r.request().method() === "DELETE" && r.ok(),
  );
  await page.getByRole("button", { name: /excluir/i }).click();
  await deleted;
  await expect(page.locator(".react-flow__node-mindmap")).toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow__node-mindmap")).toHaveCount(0);
});
