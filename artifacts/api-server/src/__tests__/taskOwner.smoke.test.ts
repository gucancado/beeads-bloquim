import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Behavioral lock for the `ownerId` field on
 * `PATCH /api/workspaces/:workspaceId/tasks/:taskId`.
 *
 * Pinned invariants:
 *  - Patching `ownerId` to a different member returns 200 and persists
 *    `task.ownerId`.
 *  - Exactly one `owner_changed` activity is recorded, carrying
 *    `metadata.newOwnerId` (the new owner) and `metadata.oldOwnerName`
 *    (the previous owner's name).
 *  - Patching `ownerId` to the CURRENT owner is a no-op: no new
 *    `owner_changed` activity is recorded.
 *
 * Tasks created via `POST /api/workspaces/:wId/tasks` default `ownerId` to the
 * creator (the admin agent here), so the initial owner is the admin.
 */
describe("task owner smoke", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("PATCH ownerId to another member changes owner and records owner_changed once", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin("Owner Alice");
    createdUserIds.push(adminUser.id);
    const { user: other } = await registerAndLogin("Owner Bob");
    createdUserIds.push(other.id);

    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Owner WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const inv = await adminAgent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: other.email, role: "editor" });
    expect(inv.status).toBe(201);

    const created = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks`)
      .send({ title: "Owned task" });
    expect(created.status).toBe(201);
    const taskId = created.body.id as string;
    // Initial owner is the creator (admin).
    expect(created.body.ownerId).toBe(adminUser.id);

    // === Change owner to the other member ===
    const patch = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
      .send({ ownerId: other.id });
    expect(patch.status).toBe(200);
    expect(patch.body.ownerId).toBe(other.id);

    const acts = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${taskId}/activities`,
    );
    expect(acts.status).toBe(200);
    const ownerChanges = (
      acts.body as Array<{ type: string; metadata: Record<string, unknown> }>
    ).filter((a) => a.type === "owner_changed");
    expect(ownerChanges.length).toBe(1);
    expect(ownerChanges[0].metadata.newOwnerId).toBe(other.id);
    expect(ownerChanges[0].metadata.oldOwnerName).toBe(adminUser.name);

    // === Task detail hydrates ownerName / ownerAvatarUrl ===
    const detail = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${taskId}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.ownerId).toBe(other.id);
    expect(detail.body.ownerName).toBe(other.name);
    expect("ownerAvatarUrl" in detail.body).toBe(true);
  });

  it("PATCH ownerId equal to current owner records no new owner_changed", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);

    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Owner Noop WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const created = await adminAgent
      .post(`/api/workspaces/${workspaceId}/tasks`)
      .send({ title: "Owned task noop" });
    expect(created.status).toBe(201);
    const taskId = created.body.id as string;
    expect(created.body.ownerId).toBe(adminUser.id);

    // Patch ownerId to the SAME (current) owner -> no-op.
    const patch = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
      .send({ ownerId: adminUser.id });
    expect(patch.status).toBe(200);
    expect(patch.body.ownerId).toBe(adminUser.id);

    const acts = await adminAgent.get(
      `/api/workspaces/${workspaceId}/tasks/${taskId}/activities`,
    );
    expect(acts.status).toBe(200);
    const ownerChanges = (acts.body as Array<{ type: string }>).filter(
      (a) => a.type === "owner_changed",
    );
    expect(ownerChanges.length).toBe(0);
  });
});
