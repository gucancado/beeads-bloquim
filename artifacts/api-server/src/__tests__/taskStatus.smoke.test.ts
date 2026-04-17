import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Behavioral lock for `PATCH /api/workspaces/:workspaceId/tasks/:taskId/status`.
 *
 * Pinned invariants (so we can safely extract `taskStatusService` in T2.2
 * fatia 8 without behavior drift):
 *
 *  - Patching status returns 200 with the updated task body.
 *  - A `status_changed` activity is recorded on the parent when the status
 *    actually changes (and only then).
 *  - When the parent enters `completed` AND has approval children in the
 *    default `sequential` mode:
 *      * the FIRST approval child becomes `in_progress` (active step);
 *      * subsequent approval children stay `pending` (gated until prior
 *        steps approve);
 *      * the parent's `parentApprovalStatus` is set to `in_approval`.
 *  - When the parent transitions to a non-completed status (e.g.
 *    `in_progress`) and has approval children, those children get
 *    `in_progress` (via `getApprovalTaskStatus`) and a `status_changed`
 *    activity is recorded on each child whose status actually changed.
 */
describe("task status smoke", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("draft -> in_progress -> completed cascades into sequential approvals", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);
    const { user: approver2 } = await registerAndLogin();
    createdUserIds.push(approver2.id);

    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Status WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const inv = await adminAgent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: approver2.email, role: "editor" });
    expect(inv.status).toBe(201);

    const mapRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Status Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    const cardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Parent", positionX: 0, positionY: 0 });
    expect(cardRes.status).toBe(201);
    const parentTaskId = cardRes.body.taskId as string;

    // Two sequential approvers
    const ap1 = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
      .send({ approverId: adminUser.id, dueDate: null });
    expect(ap1.status).toBe(201);
    const approval1Id = ap1.body.id as string;

    const ap2 = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
      .send({ approverId: approver2.id, dueDate: null });
    expect(ap2.status).toBe(201);
    const approval2Id = ap2.body.id as string;

    // === Stage 1: draft -> in_progress ===
    const toInProgress = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/status`)
      .send({ status: "in_progress" });
    expect(toInProgress.status).toBe(200);
    expect(toInProgress.body.status).toBe("in_progress");
    expect(toInProgress.body.previousStatus).toBe("draft");

    // Both approval children get `in_progress` (getApprovalTaskStatus maps
    // any non-{draft,pending} parent state to in_progress).
    const ap1AfterStage1 = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval1Id}`,
    );
    expect(ap1AfterStage1.body.status).toBe("in_progress");
    const ap2AfterStage1 = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval2Id}`,
    );
    expect(ap2AfterStage1.body.status).toBe("in_progress");

    // status_changed activity on the parent
    const acts1 = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/activities`,
    );
    expect(acts1.status).toBe(200);
    const parentTypes1 = (acts1.body as Array<{ type: string }>).map((a) => a.type);
    expect(parentTypes1).toContain("status_changed");

    // === Stage 2: in_progress -> completed (sequential gating kicks in) ===
    const toCompleted = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/status`)
      .send({ status: "completed" });
    expect(toCompleted.status).toBe(200);
    expect(toCompleted.body.status).toBe("completed");
    expect(toCompleted.body.previousStatus).toBe("in_progress");
    expect(toCompleted.body.completedAt).toBeTruthy();
    // Parent enters the approval cycle on completion when it has children.
    expect(toCompleted.body.parentApprovalStatus).toBe("in_approval");

    // First approval child stays/goes to in_progress (active step).
    const ap1AfterStage2 = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval1Id}`,
    );
    expect(ap1AfterStage2.body.status).toBe("in_progress");

    // Second approval child is gated -> pending (sequential mode).
    const ap2AfterStage2 = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval2Id}`,
    );
    expect(ap2AfterStage2.body.status).toBe("pending");

    // === Stage 3: idempotency — patching to the SAME status does not record a new activity ===
    const actsBefore = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/activities`,
    );
    const countBefore = (actsBefore.body as Array<unknown>).length;

    const noop = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/status`)
      .send({ status: "completed" });
    expect(noop.status).toBe(200);

    const actsAfter = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/activities`,
    );
    const countAfter = (actsAfter.body as Array<unknown>).length;
    expect(countAfter).toBe(countBefore);
  });

  it("rejects invalid status with 400", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);

    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Status Invalid WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const created = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks`)
      .send({ title: "Plain task" });
    expect(created.status).toBe(201);
    const taskId = created.body.id as string;

    const bad = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}/status`)
      .send({ status: "made_up_state" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Invalid status");
  });
});
