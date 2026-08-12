import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Gate de não-regressão da CAMADA DE DADOS do canvas do plano de ação.
 *
 * Escopo honesto (Task 0.1 do plano do Mapa Estratégico): cobre o CRUD que o
 * canvas do plano de ação consome — maps, cards, connections, shapes,
 * text-elements. NÃO cobre render/interação do ReactFlow (isso fica no
 * checklist manual 0.2 + testes de caracterização 1.1). Os dois juntos formam
 * o gate de não-regressão.
 *
 * Este é o baseline congelado: deve permanecer verde antes de qualquer merge
 * que toque o CanvasBase ou as rotas de `maps`.
 */
describe("canvas data layer regression (action plan)", () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(workspaceIds);
    for (const id of userIds) await deleteUser(id);
  });

  it("map CRUD survives", async () => {
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const ws = (await agent.post("/api/workspaces").send({ name: "WS map" })).body;
    workspaceIds.push(ws.id);

    // create
    const created = await agent.post(`/api/workspaces/${ws.id}/maps`).send({ name: "M" });
    expect(created.status).toBe(201);
    const mapId = created.body.id as string;
    expect(mapId).toBeTruthy();
    // após Fase 2, kind existe e default action; antes, undefined → action
    expect(created.body.kind ?? "action").toBe("action");

    // read (list + detail)
    const list = await agent.get(`/api/workspaces/${ws.id}/maps`);
    expect(list.status).toBe(200);
    expect(list.body.find((m: { id: string }) => m.id === mapId)).toBeTruthy();

    const detail = await agent.get(`/api/workspaces/${ws.id}/maps/${mapId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(mapId);
    expect(Array.isArray(detail.body.cards)).toBe(true);
    expect(Array.isArray(detail.body.connections)).toBe(true);
    expect(Array.isArray(detail.body.shapes)).toBe(true);
    expect(Array.isArray(detail.body.textElements)).toBe(true);

    // update
    const updated = await agent.put(`/api/workspaces/${ws.id}/maps/${mapId}`).send({ name: "M2" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("M2");

    // delete
    const deleted = await agent.delete(`/api/workspaces/${ws.id}/maps/${mapId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
    const gone = await agent.get(`/api/workspaces/${ws.id}/maps/${mapId}`);
    expect(gone.status).toBe(404);
  });

  it("card CRUD survives", async () => {
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const ws = (await agent.post("/api/workspaces").send({ name: "WS card" })).body;
    workspaceIds.push(ws.id);
    const mapId = (await agent.post(`/api/workspaces/${ws.id}/maps`).send({ name: "M" })).body.id;
    const base = `/api/workspaces/${ws.id}/maps/${mapId}`;

    // create (auto-cria task vinculada)
    const created = await agent.post(`${base}/cards`).send({ title: "C", positionX: 10, positionY: 20 });
    expect(created.status).toBe(201);
    const cardId = created.body.id as string;
    expect(cardId).toBeTruthy();
    expect(created.body.mapId).toBe(mapId);
    expect(created.body.taskId).toBeTruthy();

    // read
    const read = await agent.get(`${base}/cards/${cardId}`);
    expect(read.status).toBe(200);
    expect(read.body.id).toBe(cardId);
    expect(read.body.task).toBeTruthy();

    // update
    const updated = await agent.put(`${base}/cards/${cardId}`).send({ title: "C2", positionX: 99 });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("C2");
    expect(updated.body.positionX).toBe(99);

    // appears in map detail
    const detail = await agent.get(base);
    expect(detail.body.cards.find((c: { id: string }) => c.id === cardId)).toBeTruthy();

    // delete
    const deleted = await agent.delete(`${base}/cards/${cardId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
    const gone = await agent.get(`${base}/cards/${cardId}`);
    expect(gone.status).toBe(404);
  });

  it("connection CRUD survives", async () => {
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const ws = (await agent.post("/api/workspaces").send({ name: "WS conn" })).body;
    workspaceIds.push(ws.id);
    const mapId = (await agent.post(`/api/workspaces/${ws.id}/maps`).send({ name: "M" })).body.id;
    const base = `/api/workspaces/${ws.id}/maps/${mapId}`;

    const a = (await agent.post(`${base}/cards`).send({ title: "A" })).body.id as string;
    const b = (await agent.post(`${base}/cards`).send({ title: "B" })).body.id as string;

    // create
    const created = await agent.post(`${base}/connections`).send({
      sourceCardId: a,
      targetCardId: b,
      sourceHandle: "source-right",
      targetHandle: "target-left",
    });
    expect(created.status).toBe(201);
    const connId = created.body.id as string;
    expect(connId).toBeTruthy();
    expect(created.body.mapId).toBe(mapId);

    // read (via map detail)
    const detail = await agent.get(base);
    expect(detail.body.connections.find((c: { id: string }) => c.id === connId)).toBeTruthy();

    // delete
    const deleted = await agent.delete(`${base}/connections/${connId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
    const after = await agent.get(base);
    expect(after.body.connections.find((c: { id: string }) => c.id === connId)).toBeFalsy();
  });

  it("shape CRUD survives", async () => {
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const ws = (await agent.post("/api/workspaces").send({ name: "WS shape" })).body;
    workspaceIds.push(ws.id);
    const mapId = (await agent.post(`/api/workspaces/${ws.id}/maps`).send({ name: "M" })).body.id;
    const base = `/api/workspaces/${ws.id}/maps/${mapId}`;

    // create
    const created = await agent.post(`${base}/shapes`).send({ type: "rect", positionX: 5, positionY: 6 });
    expect(created.status).toBe(201);
    const shapeId = created.body.id as string;
    expect(shapeId).toBeTruthy();
    expect(created.body.mapId).toBe(mapId);
    expect(created.body.type).toBe("rect");

    // read (list)
    const list = await agent.get(`${base}/shapes`);
    expect(list.status).toBe(200);
    expect(list.body.find((s: { id: string }) => s.id === shapeId)).toBeTruthy();

    // update
    const updated = await agent.put(`${base}/shapes/${shapeId}`).send({ positionX: 77, color: "#abcdef" });
    expect(updated.status).toBe(200);
    expect(updated.body.positionX).toBe(77);
    expect(updated.body.color).toBe("#abcdef");

    // delete
    const deleted = await agent.delete(`${base}/shapes/${shapeId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
    const after = await agent.get(`${base}/shapes`);
    expect(after.body.find((s: { id: string }) => s.id === shapeId)).toBeFalsy();
  });

  it("text-element CRUD survives", async () => {
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const ws = (await agent.post("/api/workspaces").send({ name: "WS text" })).body;
    workspaceIds.push(ws.id);
    const mapId = (await agent.post(`/api/workspaces/${ws.id}/maps`).send({ name: "M" })).body.id;
    const base = `/api/workspaces/${ws.id}/maps/${mapId}`;

    // create
    const created = await agent.post(`${base}/text-elements`).send({ positionX: 1, positionY: 2 });
    expect(created.status).toBe(201);
    const elId = created.body.id as string;
    expect(elId).toBeTruthy();
    expect(created.body.mapId).toBe(mapId);

    // read (via map detail)
    const detail = await agent.get(base);
    expect(detail.body.textElements.find((e: { id: string }) => e.id === elId)).toBeTruthy();

    // update
    const newContent = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]}';
    const updated = await agent.put(`${base}/text-elements/${elId}`).send({ content: newContent });
    expect(updated.status).toBe(200);
    expect(updated.body.content).toBe(newContent);

    // delete
    const deleted = await agent.delete(`${base}/text-elements/${elId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
    const after = await agent.get(base);
    expect(after.body.textElements.find((e: { id: string }) => e.id === elId)).toBeFalsy();
  });
});
