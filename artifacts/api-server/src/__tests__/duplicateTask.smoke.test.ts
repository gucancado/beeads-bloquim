import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Behavioral lock for `POST /api/workspaces/:workspaceId/tasks/:taskId/duplicate`.
 *
 * Covers the happy path (parent task on a map + 1 subtask + 1 approver) so we
 * can extract the duplicate handler into `taskDuplicateService` (T2.2 fatia 7)
 * with confidence that:
 *   - the new task is created in `draft` status with the original's title,
 *     description, priority, assignee, mapId and approvalMode;
 *   - subtasks are deep-copied (text, completed, order);
 *   - approvers are deep-copied as new approval-tasks parented to the new
 *     task, with their own freshly-created approval cards on the same map;
 *   - a `task_duplicated` activity is recorded on the new task.
 */
describe("duplicate task smoke", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("duplicates a task with card + subtasks + approver", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);
    const { user: approver2 } = await registerAndLogin();
    createdUserIds.push(approver2.id);

    // workspace + member + map + parent card (gives us the parent taskId)
    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Duplicate WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const inv = await adminAgent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: approver2.email, role: "editor" });
    expect(inv.status).toBe(201);

    const mapRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Dup Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    const cardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Original parent", positionX: 100, positionY: 100 });
    expect(cardRes.status).toBe(201);
    const parentTaskId = cardRes.body.taskId as string;

    // Patch the parent so we have a description + non-default priority to
    // verify they are carried over.
    const patchRes = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}`)
      .send({ description: "Original description", priority: "high" });
    expect(patchRes.status).toBe(200);

    // 2 subtasks (PUT bulk replace)
    const putSubs = await adminAgent
      .put(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/subtasks`)
      .send({
        subtasks: [
          { text: "first subtask", completed: false, order: 0 },
          { text: "second subtask", completed: true, order: 1 },
        ],
      });
    expect(putSubs.status).toBe(200);
    expect(putSubs.body.length).toBe(2);

    // 1 approver
    const ap1 = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
      .send({ approverId: approver2.id, dueDate: null });
    expect(ap1.status).toBe(201);
    const originalApprovalId = ap1.body.id as string;

    // ===== DUPLICATE =====
    const dupRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/duplicate`)
      .send({});
    expect(dupRes.status).toBe(201);
    const dup = dupRes.body as {
      id: string;
      cardId: string | null;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      assignedTo: string | null;
      workspaceId: string;
      mapId: string | null;
      approvalMode: string;
    };

    expect(dup.id).toBeTruthy();
    expect(dup.id).not.toBe(parentTaskId);
    expect(dup.title).toBe("Original parent");
    expect(dup.description).toBe("Original description");
    expect(dup.status).toBe("draft");
    expect(dup.priority).toBe("high");
    expect(dup.workspaceId).toBe(workspaceId);
    expect(dup.mapId).toBe(mapId);
    expect(dup.cardId).toBeTruthy();

    // subtasks deep-copied
    const newSubs = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${dup.id}/subtasks`,
    );
    expect(newSubs.status).toBe(200);
    expect(newSubs.body.length).toBe(2);
    const sortedNew = (newSubs.body as Array<{ text: string; completed: boolean; order: number }>)
      .slice()
      .sort((a, b) => a.order - b.order);
    expect(sortedNew[0].text).toBe("first subtask");
    expect(sortedNew[0].completed).toBe(false);
    expect(sortedNew[1].text).toBe("second subtask");
    expect(sortedNew[1].completed).toBe(true);

    // approver deep-copied (new approval-task parented to the new task)
    const newApprovals = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${dup.id}/approvals`,
    );
    expect(newApprovals.status).toBe(200);
    expect(newApprovals.body.approvalMode).toBe("sequential");
    expect(newApprovals.body.approvals.length).toBe(1);
    const newApproval = newApprovals.body.approvals[0];
    expect(newApproval.assignedTo).toBe(approver2.id);
    expect(newApproval.id).not.toBe(originalApprovalId);

    // map now has all four cards: original parent, original approval,
    // duplicated parent, duplicated approval
    const mapAfter = await adminAgent.get(
      `/api/workspaces/${workspaceId}/maps/${mapId}`,
    );
    expect(mapAfter.status).toBe(200);
    const cards: Array<{ taskId: string | null }> = mapAfter.body.cards;
    const taskIdsOnMap = new Set(cards.map((c) => c.taskId));
    expect(taskIdsOnMap.has(parentTaskId)).toBe(true);
    expect(taskIdsOnMap.has(originalApprovalId)).toBe(true);
    expect(taskIdsOnMap.has(dup.id)).toBe(true);
    expect(taskIdsOnMap.has(newApproval.id)).toBe(true);

    // task_duplicated activity recorded on the new task
    const activities = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${dup.id}/activities`,
    );
    expect(activities.status).toBe(200);
    const types = (activities.body as Array<{ type: string }>).map((a) => a.type);
    expect(types).toContain("task_duplicated");
  });
});
