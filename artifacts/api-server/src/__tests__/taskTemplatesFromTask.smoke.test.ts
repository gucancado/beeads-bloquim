import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

describe("POST /api/task-templates/from-task", () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(workspaceIds);
    for (const id of userIds) await deleteUser(id);
  });

  it("cria modelo copiando título, descrição, prioridade e checklist; aplica regras de acesso", async () => {
    const { agent, user } = await registerAndLogin("Dono");
    userIds.push(user.id);
    const { agent: outsider, user: outsiderUser } = await registerAndLogin("Fora");
    userIds.push(outsiderUser.id);
    const { user: approver } = await registerAndLogin("Aprovador");
    userIds.push(approver.id);

    const ws = await agent.post("/api/workspaces").send({ name: "FromTask WS", colorIndex: 0 });
    expect(ws.status).toBe(201);
    const workspaceId = ws.body.id as string;
    workspaceIds.push(workspaceId);
    const inv = await agent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: approver.email, role: "editor" });
    expect(inv.status).toBe(201);

    const map = await agent.post(`/api/workspaces/${workspaceId}/maps`).send({ name: "M" });
    const mapId = map.body.id as string;
    const card = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Publicar post", positionX: 0, positionY: 0 });
    expect(card.status).toBe(201);
    const taskId = card.body.taskId as string;

    const patch = await agent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
      .send({ description: "texto da descrição", priority: "high" });
    expect(patch.status).toBe(200);
    const subs = await agent
      .put(`/api/workspaces/${workspaceId}/tasks/${taskId}/subtasks`)
      .send({
        subtasks: [
          { text: "rascunho", completed: true, order: 0 },
          { text: "revisão", completed: false, order: 1 },
        ],
      });
    expect(subs.status).toBe(200);

    // happy path
    const res = await agent.post("/api/task-templates/from-task").send({ taskId });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Publicar post");
    expect(res.body.title).toBe("Publicar post");
    expect(res.body.description).toBe("texto da descrição");
    expect(res.body.priority).toBe("high");
    expect(res.body.userId).toBe(user.id);
    const tplSubs = res.body.subtasks as Array<{ title: string; order: number }>;
    expect(tplSubs.map((s) => [s.title, s.order])).toEqual([
      ["rascunho", 0],
      ["revisão", 1],
    ]);

    // aparece na lista do usuário
    const list = await agent.get("/api/task-templates");
    expect((list.body as Array<{ id: string }>).some((t) => t.id === res.body.id)).toBe(true);

    // não-membro do workspace → 403
    const forbidden = await outsider.post("/api/task-templates/from-task").send({ taskId });
    expect(forbidden.status).toBe(403);

    // tarefa de aprovação → 400
    const ap = await agent
      .post(`/api/workspaces/${workspaceId}/tasks/${taskId}/approvals`)
      .send({ approverId: approver.id, dueDate: null });
    expect(ap.status).toBe(201);
    const approvalRes = await agent
      .post("/api/task-templates/from-task")
      .send({ taskId: ap.body.id as string });
    expect(approvalRes.status).toBe(400);

    // inexistente → 404; inválido → 400
    const missing = await agent.post("/api/task-templates/from-task").send({ taskId: randomUUID() });
    expect(missing.status).toBe(404);
    const invalid = await agent.post("/api/task-templates/from-task").send({ taskId: "x" });
    expect(invalid.status).toBe(400);
  });
});
