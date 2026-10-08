import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Aplicar modelo numa tarefa que vive num card do mapa: o modal aberto pelo
 * mapa lê título e descrição do CARD (cards.title / cards.description), então o
 * apply precisa espelhar no card o que grava na tarefa. Antes, só a tarefa
 * mudava e o modal reabria mostrando o título antigo (e o salvava de volta).
 */
describe("POST /api/task-templates/:id/apply em tarefa de card", () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(workspaceIds);
    for (const id of userIds) await deleteUser(id);
  });

  it("espelha título e descrição do modelo no card vinculado", async () => {
    const { agent, user } = await registerAndLogin("Dono apply card");
    userIds.push(user.id);

    const ws = await agent.post("/api/workspaces").send({ name: "Apply card WS", colorIndex: 0 });
    expect(ws.status).toBe(201);
    const workspaceId = ws.body.id as string;
    workspaceIds.push(workspaceId);
    const map = await agent.post(`/api/workspaces/${workspaceId}/maps`).send({ name: "M" });
    const mapId = map.body.id as string;

    const card = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "beta", description: "desc do card", positionX: 0, positionY: 0 });
    expect(card.status).toBe(201);
    const cardId = card.body.id as string;
    const taskId = card.body.taskId as string;

    const tpl = await agent.post("/api/task-templates");
    expect(tpl.status).toBe(201);
    const templateId = tpl.body.id as string;
    const upd = await agent
      .patch(`/api/task-templates/${templateId}`)
      .send({ name: "alfa", title: "alfa", description: "desc do modelo", priority: "high" });
    expect(upd.status).toBe(200);

    const applied = await agent.post(`/api/task-templates/${templateId}/apply`).send({ taskId });
    expect(applied.status).toBe(200);

    const got = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`);
    expect(got.status).toBe(200);
    expect(got.body.title).toBe("alfa");
    expect(got.body.description).toBe("desc do card\n\ndesc do modelo");
    expect(got.body.task.title).toBe("alfa");
    expect(got.body.task.priority).toBe("high");

    // Modelo sem título nem descrição não mexe no card.
    const empty = await agent.post("/api/task-templates");
    const again = await agent
      .post(`/api/task-templates/${empty.body.id as string}/apply`)
      .send({ taskId });
    expect(again.status).toBe(200);
    const after = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`);
    expect(after.body.title).toBe("alfa");
    expect(after.body.description).toBe("desc do card\n\ndesc do modelo");

    await agent.delete(`/api/task-templates/${templateId}`);
    await agent.delete(`/api/task-templates/${empty.body.id as string}`);
  });
});
