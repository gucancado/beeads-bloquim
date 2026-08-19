import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Behavioral lock for the "nova tarefa" flow of the Minhas Tarefas page.
 *
 * The modal auto-creates a STANDALONE task (`POST /api/my-tasks`) and lets the
 * user attach it to a workspace/plan without closing. The moment the task gets
 * a `workspace_id`, every `/api/my-tasks/:taskId*` write answers 403
 * ("Use a rota do workspace") — the client MUST re-scope its reads/writes to
 * `/api/workspaces/:workspaceId/tasks/:taskId*`.
 *
 * The frontend used to freeze that decision on the workspaceId prop the modal
 * was opened with (always empty on Minhas Tarefas), so changing the status
 * right after picking a workspace produced "Erro ao atualizar status". These
 * tests pin the server-side contract the fixed client relies on.
 */
describe("my-tasks -> workspace handoff smoke", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("standalone task attached to a workspace is fully editable through the workspace routes", async () => {
    const { agent, user } = await registerAndLogin("Handoff Owner");
    createdUserIds.push(user.id);
    const { user: mate } = await registerAndLogin("Handoff Mate");
    createdUserIds.push(mate.id);

    const wsRes = await agent
      .post("/api/workspaces")
      .send({ name: "Handoff WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const inv = await agent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: mate.email, role: "editor" });
    expect(inv.status).toBe(201);

    const mapRes = await agent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Handoff Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    // 1. The modal auto-creates a standalone task.
    const created = await agent
      .post("/api/my-tasks")
      .send({ title: "nova tarefa", priority: "medium" });
    expect(created.status).toBe(201);
    const taskId = created.body.id as string;
    expect(created.body.workspaceId).toBeNull();
    expect(created.body.status).toBe("draft");

    // 2. User picks a workspace inside the modal.
    const assoc = await agent
      .patch(`/api/my-tasks/${taskId}/association`)
      .send({ workspaceId, mapId: null });
    expect(assoc.status).toBe(200);
    expect(assoc.body.workspaceId).toBe(workspaceId);

    // 3. From here the standalone routes are closed — this is the 403 the UI hit.
    const standaloneStatus = await agent
      .patch(`/api/my-tasks/${taskId}/status`)
      .send({ status: "in_progress" });
    expect(standaloneStatus.status).toBe(403);
    const standaloneGet = await agent.get(`/api/my-tasks/${taskId}`);
    expect(standaloneGet.status).toBe(403);
    const standalonePatch = await agent
      .patch(`/api/my-tasks/${taskId}`)
      .send({ title: "editado" });
    expect(standalonePatch.status).toBe(403);

    // 4. ...and the workspace routes answer for the very same task: read,
    //    status, responsável, prioridade, prazo e título.
    const wsGet = await agent.get(`/api/workspaces/${workspaceId}/tasks/${taskId}`);
    expect(wsGet.status).toBe(200);
    expect(wsGet.body.id).toBe(taskId);

    const wsStatus = await agent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}/status`)
      .send({ status: "in_progress" });
    expect(wsStatus.status).toBe(200);
    expect(wsStatus.body.status).toBe("in_progress");

    const wsPatch = await agent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
      .send({
        title: "tarefa editada",
        assignedTo: mate.id,
        priority: "high",
        scheduleMode: "ate",
        dueDate: "2030-01-15",
      });
    expect(wsPatch.status).toBe(200);
    expect(wsPatch.body.title).toBe("tarefa editada");
    expect(wsPatch.body.assignedTo).toBe(mate.id);
    expect(wsPatch.body.priority).toBe("high");

    const afterEdit = await agent.get(`/api/workspaces/${workspaceId}/tasks/${taskId}`);
    expect(afterEdit.status).toBe(200);
    expect(afterEdit.body.status).toBe("in_progress");
    expect(afterEdit.body.assignedTo).toBe(mate.id);

    // 5. Plano: associating a map keeps working on a workspace task and mirrors
    //    the task as a card on the canvas.
    const withMap = await agent
      .patch(`/api/my-tasks/${taskId}/association`)
      .send({ mapId });
    expect(withMap.status).toBe(200);
    expect(withMap.body.mapId).toBe(mapId);

    const mapAfter = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    expect(mapAfter.status).toBe(200);
    const cards = (mapAfter.body.cards ?? []) as Array<{ taskId: string | null }>;
    expect(cards.some((c) => c.taskId === taskId)).toBe(true);

    // 6. Excluir: standalone route refuses (the 403 users hit in prod), the
    //    workspace route deletes — creator permission carries over the move.
    const standaloneDelete = await agent.delete(`/api/my-tasks/${taskId}`);
    expect(standaloneDelete.status).toBe(403);

    const wsDelete = await agent.delete(`/api/workspaces/${workspaceId}/tasks/${taskId}`);
    expect(wsDelete.status).toBe(200);

    const goneWs = await agent.get(`/api/workspaces/${workspaceId}/tasks/${taskId}`);
    expect(goneWs.status).toBe(404);
    // ~25 sequential round-trips against the remote dev DB — over the 20s default.
  }, 60_000);

  it("detaching the workspace hands the task back to the standalone routes", async () => {
    const { agent, user } = await registerAndLogin("Detach Owner");
    createdUserIds.push(user.id);

    const wsRes = await agent
      .post("/api/workspaces")
      .send({ name: "Detach WS", colorIndex: 1 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const created = await agent
      .post("/api/my-tasks")
      .send({ title: "nova tarefa", priority: "medium" });
    expect(created.status).toBe(201);
    const taskId = created.body.id as string;

    const attach = await agent
      .patch(`/api/my-tasks/${taskId}/association`)
      .send({ workspaceId, mapId: null });
    expect(attach.status).toBe(200);

    const detach = await agent
      .patch(`/api/my-tasks/${taskId}/association`)
      .send({ workspaceId: null, mapId: null });
    expect(detach.status).toBe(200);
    expect(detach.body.workspaceId).toBeNull();
    expect(detach.body.assignedTo).toBe(user.id);

    const standaloneStatus = await agent
      .patch(`/api/my-tasks/${taskId}/status`)
      .send({ status: "pending" });
    expect(standaloneStatus.status).toBe(200);
    expect(standaloneStatus.body.status).toBe("pending");

    // And the workspace route no longer owns it.
    const wsGet = await agent.get(`/api/workspaces/${workspaceId}/tasks/${taskId}`);
    expect(wsGet.status).toBe(404);
  });

  it("keeps a non-member out of the workspace it was never invited to", async () => {
    const { agent: ownerAgent, user: owner } = await registerAndLogin("Guard Owner");
    createdUserIds.push(owner.id);
    const { agent: outsiderAgent, user: outsider } = await registerAndLogin("Guard Outsider");
    createdUserIds.push(outsider.id);

    const wsRes = await ownerAgent
      .post("/api/workspaces")
      .send({ name: "Guard WS", colorIndex: 2 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const created = await outsiderAgent
      .post("/api/my-tasks")
      .send({ title: "nova tarefa", priority: "medium" });
    expect(created.status).toBe(201);
    const taskId = created.body.id as string;

    const assoc = await outsiderAgent
      .patch(`/api/my-tasks/${taskId}/association`)
      .send({ workspaceId, mapId: null });
    expect(assoc.status).toBe(403);

    // The task stays standalone and editable by its owner.
    const status = await outsiderAgent
      .patch(`/api/my-tasks/${taskId}/status`)
      .send({ status: "in_progress" });
    expect(status.status).toBe(200);
    expect(status.body.status).toBe("in_progress");
  });
});
