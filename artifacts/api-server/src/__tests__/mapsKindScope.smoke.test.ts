import { describe, it, expect, afterAll } from "vitest";
import { db } from "@workspace/db";
import { maps } from "@workspace/db/schema";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Gap #5 — guarda por escopo default em `maps`. Toda listagem de mapas
 * (GET /maps, /maps/search, /maps/recent, sidebar) deve retornar SÓ kind='action'
 * e NUNCA kind='strategy'. O canvas strategy só é acessível pela rota dedicada.
 */
describe("maps kind scope guard (action-only listings)", () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(workspaceIds);
    for (const id of userIds) await deleteUser(id);
  });

  it("strategy maps never leak into any map listing", async () => {
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);

    const ws = (await agent.post("/api/workspaces").send({ name: "ScopeWS" })).body;
    workspaceIds.push(ws.id);

    // action map via API
    const actionMap = (await agent.post(`/api/workspaces/${ws.id}/maps`).send({ name: "ScopeActionMap" })).body;
    expect(actionMap.kind).toBe("action");

    // strategy map inserido direto (não há rota de criação genérica)
    const [strategyMap] = await db
      .insert(maps)
      .values({ workspaceId: ws.id, name: "ScopeStrategyMap", kind: "strategy", createdBy: user.id })
      .returning();

    // registra acesso aos dois p/ aparecerem em /recent
    await agent.post(`/api/workspaces/${ws.id}/maps/${actionMap.id}/access`);
    await agent.post(`/api/workspaces/${ws.id}/maps/${strategyMap.id}/access`);

    const hasStrategy = (arr: Array<{ id: string }>) => arr.some((m) => m.id === strategyMap.id);
    const hasAction = (arr: Array<{ id: string }>) => arr.some((m) => m.id === actionMap.id);

    // 1) GET /workspaces/:id/maps
    const list = await agent.get(`/api/workspaces/${ws.id}/maps`);
    expect(list.status).toBe(200);
    expect(hasAction(list.body)).toBe(true);
    expect(hasStrategy(list.body)).toBe(false);

    // 2) GET /workspaces/:id/maps/search?q=Scope
    const wsSearch = await agent.get(`/api/workspaces/${ws.id}/maps/search?q=Scope`);
    expect(wsSearch.status).toBe(200);
    expect(hasStrategy(wsSearch.body)).toBe(false);

    // 3) GET /maps/search?q=Scope (cross-workspace)
    const globalSearch = await agent.get(`/api/maps/search?q=Scope`);
    expect(globalSearch.status).toBe(200);
    expect(hasStrategy(globalSearch.body)).toBe(false);

    // 4) GET /maps/recent
    const recent = await agent.get(`/api/maps/recent`);
    expect(recent.status).toBe(200);
    expect(recent.body.some((r: { mapId: string }) => r.mapId === strategyMap.id)).toBe(false);

    // 5) GET /sidebar/workspaces → ws.maps exclui strategy
    const sidebar = await agent.get(`/api/sidebar/workspaces`);
    expect(sidebar.status).toBe(200);
    const wsEntry = sidebar.body.find((w: { id: string }) => w.id === ws.id);
    expect(wsEntry).toBeTruthy();
    expect(hasStrategy(wsEntry.maps)).toBe(false);
    expect(hasAction(wsEntry.maps)).toBe(true);
  });
});
