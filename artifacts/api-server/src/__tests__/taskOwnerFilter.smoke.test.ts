import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Behavioral lock for the status-aware assignee filter on
 * `GET /api/workspaces/:workspaceId/tasks`.
 *
 * The "draft" (rascunho) status filter resolves by OWNER (`tasks.ownerId`),
 * while every other status filters by ASSIGNEE (`tasks.assignedTo`). Mixed
 * selections resolve per-row: a draft row matches on owner, a non-draft row
 * matches on assignee.
 *
 * Fixture (workspace W, admin A + member B):
 *  - taskDraft:   status draft,   owner A, assignee B
 *  - taskPending: status pending, owner B, assignee A
 */
describe("workspace task list — draft filters by owner", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("draft scopes by owner, other statuses scope by assignee, mixed resolves per-row", async () => {
    const { agent: A, user: userA } = await registerAndLogin("Filter Alice");
    createdUserIds.push(userA.id);
    const { user: userB } = await registerAndLogin("Filter Bob");
    createdUserIds.push(userB.id);

    const wsRes = await A.post("/api/workspaces").send({ name: "Filter WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const inv = await A.post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: userB.email, role: "editor" });
    expect(inv.status).toBe(201);

    // taskDraft: created by A -> status draft, owner A. Reassign to B.
    const draftRes = await A.post(`/api/workspaces/${workspaceId}/tasks`)
      .send({ title: "Draft task" });
    expect(draftRes.status).toBe(201);
    const taskDraft = draftRes.body.id as string;
    expect(draftRes.body.status).toBe("draft");
    expect(draftRes.body.ownerId).toBe(userA.id);
    const draftPatch = await A.patch(`/api/workspaces/${workspaceId}/tasks/${taskDraft}`)
      .send({ assignedTo: userB.id });
    expect(draftPatch.status).toBe(200);
    expect(draftPatch.body.assignedTo).toBe(userB.id);

    // taskPending: created by A (status draft, owner A, assignee A).
    // Set assignee A (already), owner B, status pending.
    const pendingRes = await A.post(`/api/workspaces/${workspaceId}/tasks`)
      .send({ title: "Pending task" });
    expect(pendingRes.status).toBe(201);
    const taskPending = pendingRes.body.id as string;
    const ownerPatch = await A.patch(`/api/workspaces/${workspaceId}/tasks/${taskPending}`)
      .send({ ownerId: userB.id, assignedTo: userA.id });
    expect(ownerPatch.status).toBe(200);
    expect(ownerPatch.body.ownerId).toBe(userB.id);
    expect(ownerPatch.body.assignedTo).toBe(userA.id);
    const statusPatch = await A.patch(`/api/workspaces/${workspaceId}/tasks/${taskPending}/status`)
      .send({ status: "pending" });
    expect(statusPatch.status).toBe(200);

    const ids = async (qs: string): Promise<string[]> => {
      const res = await A.get(`/api/workspaces/${workspaceId}/tasks?${qs}`);
      expect(res.status).toBe(200);
      return (res.body as Array<{ id: string }>).map((t) => t.id);
    };

    // 1. status=draft & assignedTo=A -> taskDraft (owner A), not taskPending.
    const r1 = await ids(`status=draft&assignedTo=${userA.id}`);
    expect(r1).toContain(taskDraft);
    expect(r1).not.toContain(taskPending);

    // 2. status=pending & assignedTo=A -> taskPending (assignee A), not taskDraft.
    const r2 = await ids(`status=pending&assignedTo=${userA.id}`);
    expect(r2).toContain(taskPending);
    expect(r2).not.toContain(taskDraft);

    // 3. status=draft,pending & assignedTo=A -> BOTH (draft by owner A, pending by assignee A).
    const r3 = await ids(`status=draft,pending&assignedTo=${userA.id}`);
    expect(r3).toContain(taskDraft);
    expect(r3).toContain(taskPending);

    // 4. status=draft & assignedTo=B -> neither: taskDraft owner is A (not B),
    //    taskPending is excluded by the status filter (pending != draft).
    const r4 = await ids(`status=draft&assignedTo=${userB.id}`);
    expect(r4).not.toContain(taskDraft);
    expect(r4).not.toContain(taskPending);
  });
});
