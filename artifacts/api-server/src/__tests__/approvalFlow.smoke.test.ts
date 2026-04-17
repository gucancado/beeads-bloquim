import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser } from "./helpers";

/**
 * Approval-chain smoke tests.
 *
 * These exercise the helpers extracted to `services/approvalChainService` and
 * `services/taskVisualSyncService` (T2.2 fatias 1 e 2) end-to-end via HTTP, so
 * a behavioral regression in the extraction would be caught here.
 *
 * Default `approvalMode` for a parent task is `sequential`, in which case:
 *  - all approvals start in `pending` (status) / `pending` (approvalStatus);
 *    sequential gating is enforced when the parent is moved to `in_progress`
 *    by the approve step (see `routes/workspaceTasks` POST /:taskId/approve);
 *  - approving the first step keeps the chain progressing to the next pending
 *    sibling.
 */
describe("approval flow smoke", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("create parent + 2 approvals (sequential) -> approve first -> state is consistent", async () => {
    // Two users: admin/owner of workspace + a second user that will be the
    // second approver (you cannot add the same member twice as approver).
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);
    const { user: approver2 } = await registerAndLogin();
    createdUserIds.push(approver2.id);

    // workspace + map + parent task on the map
    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Approvals WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;

    // invite second user as editor so they're a workspace member
    const inviteRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: approver2.email, role: "editor" });
    expect(inviteRes.status).toBe(201);

    const mapRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Approvals Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    // Parent task must live on the map so an approval card is created
    // (this exercises `getApprovalChainInfo` -> parent card lookup).
    const cardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Parent", positionX: 0, positionY: 0 });
    expect(cardRes.status).toBe(201);
    const parentTaskId = cardRes.body.taskId as string;
    expect(parentTaskId).toBeTruthy();

    // approval #1 -> admin user
    const ap1 = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
      .send({ approverId: adminUser.id, dueDate: null });
    expect(ap1.status).toBe(201);
    expect(ap1.body.approvalOrder).toBe(0);
    const approval1Id = ap1.body.id as string;

    // approval #2 -> second user
    const ap2 = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
      .send({ approverId: approver2.id, dueDate: null });
    expect(ap2.status).toBe(201);
    expect(ap2.body.approvalOrder).toBe(1);
    const approval2Id = ap2.body.id as string;

    // list approvals -> ordered by approvalOrder
    const list = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`,
    );
    expect(list.status).toBe(200);
    expect(list.body.approvalMode).toBe("sequential");
    expect(Array.isArray(list.body.approvals)).toBe(true);
    expect(list.body.approvals.length).toBe(2);
    expect(list.body.approvals[0].id).toBe(approval1Id);
    expect(list.body.approvals[1].id).toBe(approval2Id);

    // both approval cards must have been created on the map
    const mapAfterAdds = await adminAgent.get(
      `/api/workspaces/${workspaceId}/maps/${mapId}`,
    );
    expect(mapAfterAdds.status).toBe(200);
    const approvalCards: Array<{ taskId: string | null }> =
      mapAfterAdds.body.cards;
    const approvalCardIds = new Set(
      approvalCards
        .filter((c) => c.taskId === approval1Id || c.taskId === approval2Id)
        .map((c) => c.taskId),
    );
    expect(approvalCardIds.size).toBe(2);

    // approve the FIRST step (admin approves their own step)
    const approveRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${approval1Id}/approve`)
      .send({ comment: "ok" });
    expect(approveRes.status).toBe(200);

    // approval #1 must now be completed + approved
    const after1 = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval1Id}`,
    );
    expect(after1.status).toBe(200);
    expect(after1.body.status).toBe("completed");
    expect(after1.body.approvalStatus).toBe("approved");

    // approval #2 still pending approval (not yet approved by approver2)
    const after2 = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval2Id}`,
    );
    expect(after2.status).toBe(200);
    expect(after2.body.approvalStatus).not.toBe("approved");

    // parent task must NOT be completed yet (chain still has #2 pending)
    const parentAfter = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}`,
    );
    expect(parentAfter.status).toBe(200);
    expect(parentAfter.body.status).not.toBe("completed");

    // an approval activity must be recorded on the parent
    const acts = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/activities`,
    );
    expect(acts.status).toBe(200);
    expect(
      acts.body.find((a: { type: string }) => a.type === "approval_comment"),
    ).toBeTruthy();
  });

  it("reorder approvals -> list reflects new order (exercises chain reroute)", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);
    const { user: approver2 } = await registerAndLogin();
    createdUserIds.push(approver2.id);
    const { user: approver3 } = await registerAndLogin();
    createdUserIds.push(approver3.id);

    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Reorder WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;

    for (const u of [approver2, approver3]) {
      const inv = await adminAgent
        .post(`/api/workspaces/${workspaceId}/members`)
        .send({ email: u.email, role: "editor" });
      expect(inv.status).toBe(201);
    }

    const mapRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Reorder Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    const cardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Parent", positionX: 0, positionY: 0 });
    expect(cardRes.status).toBe(201);
    const parentTaskId = cardRes.body.taskId as string;

    // 3 approvals in order: admin, approver2, approver3
    const ids: string[] = [];
    for (const approverId of [adminUser.id, approver2.id, approver3.id]) {
      const r = await adminAgent
        .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
        .send({ approverId, dueDate: null });
      expect(r.status).toBe(201);
      ids.push(r.body.id as string);
    }

    // sanity: initial order
    const before = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`,
    );
    expect(before.body.approvals.map((a: { id: string }) => a.id)).toEqual(ids);

    // reorder: reverse the chain
    const reversed = [...ids].reverse();
    const reorder = await adminAgent
      .put(
        `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals/reorder`,
      )
      .send({ orderedIds: reversed });
    expect(reorder.status).toBe(200);

    const after = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`,
    );
    expect(after.status).toBe(200);
    expect(after.body.approvals.map((a: { id: string }) => a.id)).toEqual(
      reversed,
    );
    after.body.approvals.forEach((a: { approvalOrder: number }, i: number) => {
      expect(a.approvalOrder).toBe(i);
    });
  });
});
