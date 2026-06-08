import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Behavioral lock for the `ownerId` field on the card-linked task-details
 * endpoint `PATCH /api/workspaces/:wId/maps/:mId/cards/:cId/task/details`
 * (mounted at `/:cardId/task/details` in cards.ts).
 *
 * Pinned invariants (mirrors the workspace PATCH owner behaviour):
 *  - Patching `ownerId` to a different member returns 200 and persists
 *    `task.ownerId`.
 *  - Exactly one `owner_changed` activity is recorded, carrying
 *    `metadata.newOwnerId` (the new owner) and `metadata.oldOwnerName`
 *    (the previous owner's name).
 *  - Patching `ownerId` to the CURRENT owner is a no-op: no new
 *    `owner_changed` activity is recorded.
 *
 * Cards created via `POST /api/workspaces/:wId/maps/:mId/cards` create a task
 * whose owner defaults to the creator (the admin agent here).
 */
describe("card task owner smoke", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("PATCH card details ownerId to another member changes owner and records owner_changed once", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin("Card Owner Alice");
    createdUserIds.push(adminUser.id);
    const { user: other } = await registerAndLogin("Card Owner Bob");
    createdUserIds.push(other.id);

    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Card Owner WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const inv = await adminAgent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: other.email, role: "editor" });
    expect(inv.status).toBe(201);

    const mapRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Card Owner Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    const cardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Owned card task", positionX: 0, positionY: 0 });
    expect(cardRes.status).toBe(201);
    const cardId = cardRes.body.id as string;
    const taskId = cardRes.body.taskId as string;

    // === Change owner to the other member via the card details endpoint ===
    const patch = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}/task/details`)
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
  });

  it("PATCH card details ownerId equal to current owner records no new owner_changed", async () => {
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);

    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "Card Owner Noop WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const mapRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Card Owner Noop Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;

    const cardRes = await adminAgent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Owned card task noop", positionX: 0, positionY: 0 });
    expect(cardRes.status).toBe(201);
    const cardId = cardRes.body.id as string;
    const taskId = cardRes.body.taskId as string;

    // Patch ownerId to the SAME (current) owner -> no-op.
    const patch = await adminAgent
      .patch(`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}/task/details`)
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
