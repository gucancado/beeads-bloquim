import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Trava o comportamento do endpoint de auto-layout
 * `POST /api/workspaces/:wId/maps/:mId/layout` e do free-slot no
 * `POST /api/workspaces/:wId/maps/:mId/cards`.
 */
describe("map layout smoke", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  async function setupMap(name: string) {
    const { agent, user } = await registerAndLogin(`Layout ${name}`);
    createdUserIds.push(user.id);
    const ws = await agent.post("/api/workspaces").send({ name: `Layout WS ${name}`, colorIndex: 0 });
    expect(ws.status).toBe(201);
    const workspaceId = ws.body.id as string;
    createdWorkspaceIds.push(workspaceId);
    const map = await agent.post(`/api/workspaces/${workspaceId}/maps`).send({ name: `Layout Map ${name}` });
    expect(map.status).toBe(201);
    return { agent, user, workspaceId, mapId: map.body.id as string };
  }

  it("reposiciona cards conectados em colunas e não sobrepõe", async () => {
    const { agent, workspaceId, mapId } = await setupMap("chain");

    // Três cards empilhados de propósito no mesmo ponto pedido.
    const ids: string[] = [];
    for (const title of ["a", "b", "c"]) {
      const res = await agent
        .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
        .send({ title, positionX: 0, positionY: 0 });
      expect(res.status).toBe(201);
      ids.push(res.body.id as string);
    }
    const [a, b, c] = ids;

    for (const [source, target] of [[a, b], [b, c]]) {
      const conn = await agent
        .post(`/api/workspaces/${workspaceId}/maps/${mapId}/connections`)
        .send({ sourceCardId: source, targetCardId: target, sourceHandle: "source-right", targetHandle: "target-left" });
      expect(conn.status).toBe(201);
    }

    const layout = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(layout.status).toBe(200);
    expect(Array.isArray(layout.body.cards)).toBe(true);

    const map = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    expect(map.status).toBe(200);
    const byId = new Map<string, { positionX: number; positionY: number }>(
      (map.body.cards as Array<{ id: string; positionX: number; positionY: number }>).map((k) => [k.id, k]),
    );
    // Cadeia a→b→c com rankdir=LR: uma coluna por nível, 320 de passo.
    expect(byId.get(a)!.positionX).toBe(0);
    expect(byId.get(b)!.positionX).toBe(320);
    expect(byId.get(c)!.positionX).toBe(640);
    expect(byId.get(a)!.positionY).toBe(byId.get(b)!.positionY);
  });

  it("é idempotente: a segunda chamada seguida não move mais nada", async () => {
    const { agent, workspaceId, mapId } = await setupMap("idem");

    // Posições espalhadas de propósito, pra 1ª chamada ter o que mover.
    const ids: string[] = [];
    for (const [title, x, y] of [["p", 900, 900], ["q", 40, 700]] as const) {
      const res = await agent
        .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
        .send({ title, positionX: x, positionY: y });
      expect(res.status).toBe(201);
      ids.push(res.body.id as string);
    }
    const conn = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/connections`)
      .send({ sourceCardId: ids[0], targetCardId: ids[1], sourceHandle: "source-right", targetHandle: "target-left" });
    expect(conn.status).toBe(201);

    const first = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(first.status).toBe(200);
    expect(first.body.cards.length).toBeGreaterThan(0);

    const second = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(second.status).toBe(200);
    expect(second.body.cards).toEqual([]);
  });

  it("cards de aprovação transladam junto com o card pai", async () => {
    const { agent, user, workspaceId, mapId } = await setupMap("approval");

    // Card pai longe da origem, com uma conexão pra garantir que o dagre
    // realmente o traga pra perto de (0,0) no relayout (senão o teste não
    // prova nada). Adicionar um aprovador cria um card de aprovação junto.
    const parent = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Pai", positionX: 1000, positionY: 1000 });
    expect(parent.status).toBe(201);
    const parentCardId = parent.body.id as string;
    const parentTaskId = parent.body.taskId as string;

    const child = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Filho", positionX: 1400, positionY: 1000 });
    expect(child.status).toBe(201);
    const conn = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/connections`)
      .send({ sourceCardId: parentCardId, targetCardId: child.body.id, sourceHandle: "source-right", targetHandle: "target-left" });
    expect(conn.status).toBe(201);

    const ap = await agent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
      .send({ approverId: user.id, dueDate: null });
    expect(ap.status).toBe(201);

    type MapCard = { id: string; positionX: number; positionY: number; taskIsApprovalTask: boolean };
    const before = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    expect(before.status).toBe(200);
    const approvalBefore = (before.body.cards as MapCard[]).find((c) => c.taskIsApprovalTask);
    expect(approvalBefore).toBeTruthy();
    const parentBefore = (before.body.cards as MapCard[]).find((c) => c.id === parentCardId)!;

    const layout = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(layout.status).toBe(200);
    const layoutCards = layout.body.cards as Array<{ id: string; positionX: number; positionY: number }>;

    const parentMoved = layoutCards.find((c) => c.id === parentCardId);
    expect(parentMoved).toBeTruthy();
    // Prova que o cenário realmente move o pai — senão o teste não valida nada.
    const parentDx = parentMoved!.positionX - parentBefore.positionX;
    const parentDy = parentMoved!.positionY - parentBefore.positionY;
    expect(Math.abs(parentDx) >= 0.5 || Math.abs(parentDy) >= 0.5).toBe(true);

    // O card de aprovação entra na resposta, transladado pelo MESMO delta do pai.
    const approvalMoved = layoutCards.find((c) => c.id === approvalBefore!.id);
    expect(approvalMoved).toBeTruthy();
    const approvalDx = approvalMoved!.positionX - approvalBefore!.positionX;
    const approvalDy = approvalMoved!.positionY - approvalBefore!.positionY;
    expect(approvalDx).toBeCloseTo(parentDx, 5);
    expect(approvalDy).toBeCloseTo(parentDy, 5);

    // Persistido no banco também.
    const after = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    const approvalAfter = (after.body.cards as MapCard[]).find((c) => c.id === approvalBefore!.id);
    expect(approvalAfter!.positionX).toBe(approvalMoved!.positionX);
    expect(approvalAfter!.positionY).toBe(approvalMoved!.positionY);
  });

  it("card ligado por um card de aprovação no meio da cadeia não vira isolado", async () => {
    // Reproduz o mapa Clínica CBV / AÇÃO CO2 (2026-07-16): editar → aprovação → subir.
    // A conexão parte do card de APROVAÇÃO. Sem roteamento, o "subir" perdia a
    // única conexão e caía na grade de isolados, longe da cadeia.
    const { agent, user, workspaceId, mapId } = await setupMap("approval-chain");

    const editar = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "editar", positionX: 0, positionY: 0 });
    expect(editar.status).toBe(201);
    const editarId = editar.body.id as string;
    const editarTaskId = editar.body.taskId as string;

    const subir = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "subir", positionX: 900, positionY: 700 });
    expect(subir.status).toBe(201);
    const subirId = subir.body.id as string;

    // aprovação no "editar" → cria o card de aprovação
    const ap = await agent
      .post(`/api/workspaces/${workspaceId}/tasks/${editarTaskId}/approvals`)
      .send({ approverId: user.id, dueDate: null });
    expect(ap.status).toBe(201);

    type MapCard = { id: string; taskIsApprovalTask: boolean };
    const mapBefore = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    const approvalCard = (mapBefore.body.cards as MapCard[]).find((c) => c.taskIsApprovalTask);
    expect(approvalCard).toBeTruthy();

    // conexão REAL saindo do card de aprovação pro "subir"
    const conn = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/connections`)
      .send({ sourceCardId: approvalCard!.id, targetCardId: subirId, sourceHandle: "source-right", targetHandle: "target-left" });
    expect(conn.status).toBe(201);

    const layout = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(layout.status).toBe(200);

    const after = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    const byId = new Map<string, { positionX: number; positionY: number }>(
      (after.body.cards as Array<{ id: string; positionX: number; positionY: number }>).map((k) => [k.id, k]),
    );
    const editarPos = byId.get(editarId)!;
    const subirPos = byId.get(subirId)!;
    // Roteado: editar → subir. Subir fica UMA coluna à direita do editar, na mesma
    // linha — parte da cadeia, não isolado abaixo dela.
    expect(subirPos.positionX).toBe(editarPos.positionX + 320);
    expect(subirPos.positionY).toBe(editarPos.positionY);
  });

  it("mapa sem cards devolve lista vazia", async () => {
    const { agent, workspaceId, mapId } = await setupMap("empty");
    const res = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(res.status).toBe(200);
    expect(res.body.cards).toEqual([]);
  });

  it("executor não pode reorganizar o mapa", async () => {
    const { agent: adminAgent, workspaceId, mapId } = await setupMap("role");
    const { agent: execAgent, user: execUser } = await registerAndLogin("Layout Executor");
    createdUserIds.push(execUser.id);

    const inv = await adminAgent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: execUser.email, role: "executor" });
    expect(inv.status).toBe(201);

    const res = await execAgent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(res.status).toBe(403);
  });

  it("card novo não nasce em cima de outro no mesmo ponto pedido", async () => {
    const { agent, workspaceId, mapId } = await setupMap("freeslot");

    const first = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "primeiro", positionX: 500, positionY: 500 });
    expect(first.status).toBe(201);
    expect(first.body.positionX).toBe(500);
    expect(first.body.positionY).toBe(500);

    const second = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "segundo", positionX: 500, positionY: 500 });
    expect(second.status).toBe(201);
    // Mesmo ponto pedido → o servidor empurra pro vizinho livre mais próximo.
    const dx = Math.abs(second.body.positionX - 500);
    const dy = Math.abs(second.body.positionY - 500);
    expect(dx >= 200 || dy >= 80).toBe(true);
  });

  it("cards sem posição (caso MCP) não empilham todos em (0,0)", async () => {
    const { agent, workspaceId, mapId } = await setupMap("mcp");

    const positions: Array<{ x: number; y: number }> = [];
    for (const title of ["t1", "t2", "t3"]) {
      const res = await agent
        .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
        .send({ title });
      expect(res.status).toBe(201);
      positions.push({ x: res.body.positionX as number, y: res.body.positionY as number });
    }

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const apart =
          Math.abs(positions[i].x - positions[j].x) >= 200 ||
          Math.abs(positions[i].y - positions[j].y) >= 80;
        expect(apart).toBe(true);
      }
    }
  });
});
