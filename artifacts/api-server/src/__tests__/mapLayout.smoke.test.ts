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

  it("cards de aprovação mantêm a posição (ficam fora do relayout)", async () => {
    const { agent, user, workspaceId, mapId } = await setupMap("approval");

    // Card pai no mapa; adicionar um aprovador cria um card de aprovação junto.
    const parent = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Pai", positionX: 0, positionY: 0 });
    expect(parent.status).toBe(201);
    const parentTaskId = parent.body.taskId as string;

    const ap = await agent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
      .send({ approverId: user.id, dueDate: null });
    expect(ap.status).toBe(201);

    type MapCard = { id: string; positionX: number; positionY: number; taskIsApprovalTask: boolean };
    const before = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    expect(before.status).toBe(200);
    const approvalBefore = (before.body.cards as MapCard[]).find((c) => c.taskIsApprovalTask);
    expect(approvalBefore).toBeTruthy();

    const layout = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(layout.status).toBe(200);
    // Nem aparece na lista de movidos...
    expect((layout.body.cards as Array<{ id: string }>).some((c) => c.id === approvalBefore!.id)).toBe(false);

    // ...nem mudou de lugar no banco.
    const after = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    const approvalAfter = (after.body.cards as MapCard[]).find((c) => c.id === approvalBefore!.id);
    expect(approvalAfter!.positionX).toBe(approvalBefore!.positionX);
    expect(approvalAfter!.positionY).toBe(approvalBefore!.positionY);
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
});
