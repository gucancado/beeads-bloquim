import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

/**
 * Caracterização do card de tarefa do canvas (MindMapNode) antes/depois da
 * extração do TaskCardBody: título, status e prazo editados inline persistem.
 */
const API = process.env.API_BASE_URL ?? "http://localhost:5000";
const PASSWORD = "E2ePass12345!";

async function api(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const r = await ctx.post("/api/auth/login", { data: { email: "e2e_tasks_owner@test.local", password: PASSWORD } });
  expect(r.ok()).toBeTruthy();
  return ctx;
}

test("card do canvas: título, status e prazo inline persistem", async ({ page, context }) => {
  const ctx = await api();
  const stamp = Date.now();
  const ws = await (await ctx.post("/api/workspaces", { data: { name: `E2E Canvas ${stamp}`, colorIndex: 0 } })).json();
  try {
    const map = await (await ctx.post(`/api/workspaces/${ws.id}/maps`, { data: { name: "plano" } })).json();
    const card = await (await ctx.post(`/api/workspaces/${ws.id}/maps/${map.id}/cards`, {
      data: { title: `card ${stamp}`, positionX: 100, positionY: 100 },
    })).json();
    // POST /cards já cria a tarefa vinculada (status draft, sem_prazo).
    expect(card.taskId, JSON.stringify(card)).toBeTruthy();

    await context.addCookies((await ctx.storageState()).cookies.map(c => ({ ...c, domain: "localhost" })));
    await page.goto(`/workspaces/${ws.id}/maps/${map.id}`);
    const node = page.locator(".react-flow__node-mindmap").first();
    await expect(node).toContainText(`card ${stamp}`);

    await node.getByText(`card ${stamp}`).click();
    const input = node.locator("input").first();
    await input.fill(`renomeado ${stamp}`);
    await input.press("Enter");

    await node.getByLabel(/status|rascunho|pronta/i).first().click();
    await page.getByRole("button", { name: /pronta para fazer/ }).click();

    await node.getByTitle("Clique para definir prazo").click();
    await expect(node.getByTitle("Modalidade do fazer")).toBeVisible();

    await page.waitForTimeout(800);
    await page.reload();
    const again = page.locator(".react-flow__node-mindmap").first();
    await expect(again).toContainText(`renomeado ${stamp}`);
    await expect(again.getByLabel("pronta para fazer")).toBeVisible();
  } finally {
    await ctx.delete(`/api/workspaces/${ws.id}`);
  }
});
