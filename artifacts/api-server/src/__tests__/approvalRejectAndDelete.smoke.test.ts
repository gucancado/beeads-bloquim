import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser } from "./helpers";

/**
 * Behavioral coverage for the two approval branches that the existing
 * smoke suite does not exercise:
 *
 *   1. POST /:taskId/reject in a sequential chain  -> resets siblings,
 *      flips parent back to in_progress, marks parent.parentApprovalStatus
 *      = "rejected", records an activity, and re-syncs visuals.
 *
 *   2. DELETE /:taskId/approvals/:approvalId on the TERMINAL approval when
 *      a downstream connection exists -> rerouteDownstreamConnections must
 *      re-attach the downstream target to the new terminal card.
 *
 * These are the most complex branches of approvalActionService /
 * rerouteDownstreamConnections. Adding them now provides regression cover
 * before the next extraction fatia (T2.2 fatia 4).
 */
describe("approval reject + delete-terminal smoke", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("reject in sequential flow resets siblings and parent state", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);
    const { user: approver2 } = await registerAndLogin();
    createdUserIds.push(approver2.id);

    // workspace + member + map + parent card
    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Reject WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;

    const inv = await adminAgent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: approver2.email, role: "editor" });
    expect(inv.status).toBe(201);

    const mapRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Reject Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    const cardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Parent", positionX: 0, positionY: 0 });
    expect(cardRes.status).toBe(201);
    const parentTaskId = cardRes.body.taskId as string;

    // 2 approvals (sequential by default): admin then approver2
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

    // Approve #1 first so we have a non-trivial sibling state to reset.
    const approveRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${approval1Id}/approve`)
      .send({ comment: "ok" });
    expect(approveRes.status).toBe(200);

    const after1Approve = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval1Id}`,
    );
    expect(after1Approve.body.approvalStatus).toBe("approved");

    // Now reject the SECOND approval (approver2 step).
    const rejectRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks/${approval2Id}/reject`)
      .send({ comment: "no good" });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.approvalStatus).toBe("rejected");
    expect(rejectRes.body.status).toBe("pending");

    // Sibling (approval #1) must have been RESET back to pending,
    // approvalStatus cleared. The rejected one keeps its decision.
    const after1Reset = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval1Id}`,
    );
    expect(after1Reset.status).toBe(200);
    expect(after1Reset.body.approvalStatus).toBeNull();
    expect(after1Reset.body.status).toBe("pending");

    const after2Rej = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval2Id}`,
    );
    expect(after2Rej.body.approvalStatus).toBe("rejected");
    expect(after2Rej.body.approvalComment).toBe("no good");

    // Parent must be marked rejected and pushed to in_progress.
    const parentAfter = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}`,
    );
    expect(parentAfter.status).toBe(200);
    expect(parentAfter.body.parentApprovalStatus).toBe("rejected");
    expect(parentAfter.body.status).toBe("in_progress");

    // task_rejected on the approval task + approval_comment(rejected) on the parent.
    const approvalActs = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${approval2Id}/activities`,
    );
    expect(approvalActs.status).toBe(200);
    expect(
      approvalActs.body.find((a: { type: string }) => a.type === "task_rejected"),
    ).toBeTruthy();

    const parentActs = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/activities`,
    );
    expect(parentActs.status).toBe(200);
    expect(
      parentActs.body.find(
        (a: { type: string; metadata?: { decision?: string } }) =>
          a.type === "approval_comment" && a.metadata?.decision === "rejected",
      ),
    ).toBeTruthy();
  });

  it("delete TERMINAL approval reroutes downstream connection to new terminal", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);
    const { user: approver2 } = await registerAndLogin();
    createdUserIds.push(approver2.id);
    const { user: approver3 } = await registerAndLogin();
    createdUserIds.push(approver3.id);

    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "DeleteTerminal WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;

    for (const u of [approver2, approver3]) {
      const r = await adminAgent
        .post(`/api/workspaces/${workspaceId}/members`)
        .send({ email: u.email, role: "editor" });
      expect(r.status).toBe(201);
    }

    const mapRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "DeleteTerminal Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    // Parent + 1 downstream task card.
    const parentCardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Parent", positionX: 0, positionY: 0 });
    expect(parentCardRes.status).toBe(201);
    const parentTaskId = parentCardRes.body.taskId as string;

    const downstreamCardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Downstream", positionX: 600, positionY: 0 });
    expect(downstreamCardRes.status).toBe(201);
    const downstreamCardId = downstreamCardRes.body.id as string;

    // 3 sequential approvals: admin, approver2, approver3 (terminal = approver3).
    const approvalIds: string[] = [];
    for (const approverId of [adminUser.id, approver2.id, approver3.id]) {
      const r = await adminAgent
        .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
        .send({ approverId, dueDate: null });
      expect(r.status).toBe(201);
      approvalIds.push(r.body.id as string);
    }
    const terminalApprovalId = approvalIds[2];
    const newTerminalApprovalId = approvalIds[1];

    // Resolve each approval task -> its card on the map.
    const mapBefore = await adminAgent.get(
      `/api/workspaces/${workspaceId}/maps/${mapId}`,
    );
    expect(mapBefore.status).toBe(200);
    const cardByTaskId = new Map<string, string>();
    for (const c of mapBefore.body.cards as Array<{
      id: string;
      taskId: string | null;
    }>) {
      if (c.taskId) cardByTaskId.set(c.taskId, c.id);
    }
    const terminalCardId = cardByTaskId.get(terminalApprovalId)!;
    const newTerminalCardId = cardByTaskId.get(newTerminalApprovalId)!;
    expect(terminalCardId).toBeTruthy();
    expect(newTerminalCardId).toBeTruthy();

    // Connect terminal approval card -> downstream card.
    const connRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/connections`)
      .send({ sourceCardId: terminalCardId, targetCardId: downstreamCardId });
    expect(connRes.status).toBe(201);

    // Sanity: the connection exists from the OLD terminal.
    const mapMid = await adminAgent.get(
      `/api/workspaces/${workspaceId}/maps/${mapId}`,
    );
    const midConns = mapMid.body.connections as Array<{
      sourceCardId: string;
      targetCardId: string;
    }>;
    expect(
      midConns.find(
        (c) =>
          c.sourceCardId === terminalCardId &&
          c.targetCardId === downstreamCardId,
      ),
    ).toBeTruthy();

    // Delete the terminal approval task. CASCADE removes the old terminal
    // card AND its outgoing connections; rerouteDownstreamConnections must
    // re-attach `downstreamCardId` from the NEW terminal (approver2's card).
    const delRes = await adminAgent.delete(
      `/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals/${terminalApprovalId}`,
    );
    expect(delRes.status).toBe(200);

    const mapAfter = await adminAgent.get(
      `/api/workspaces/${workspaceId}/maps/${mapId}`,
    );
    expect(mapAfter.status).toBe(200);

    // Old terminal card is gone (CASCADE through tasks->cards on taskId).
    const cardsAfter = mapAfter.body.cards as Array<{
      id: string;
      taskId: string | null;
    }>;
    expect(cardsAfter.find((c) => c.id === terminalCardId)).toBeFalsy();

    // The downstream connection now starts from the NEW terminal card.
    const afterConns = mapAfter.body.connections as Array<{
      sourceCardId: string;
      targetCardId: string;
    }>;
    expect(
      afterConns.find(
        (c) =>
          c.sourceCardId === newTerminalCardId &&
          c.targetCardId === downstreamCardId,
      ),
    ).toBeTruthy();

    // No connection left dangling from the deleted terminal.
    expect(
      afterConns.find((c) => c.sourceCardId === terminalCardId),
    ).toBeFalsy();
  });
});
