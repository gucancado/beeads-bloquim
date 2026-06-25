import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { makeAgent, registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { db } from "@workspace/db";
import { workspaceMembers } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

const ENDPOINT = "/api/internal/authz/workspace-role";
const VALID_TOKEN = "test-internal-api-secret-smoke";

describe("POST /api/internal/authz/workspace-role", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  let adminUserId: string;
  let editorUserId: string;
  let executorUserId: string;
  let workspaceId: string;
  let savedServiceToken: string | undefined;

  beforeAll(async () => {
    // Set the internal-secret env for this suite, saving the original so it can
    // be restored (not deleted) in afterAll — robust under parallel suites.
    // `requireInternal` reads the env lazily per-request, so this takes effect.
    savedServiceToken = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = VALID_TOKEN;

    // Create an admin user who will own the workspace.
    const { agent: adminAgent, user: adminUser } = await registerAndLogin();
    createdUserIds.push(adminUser.id);
    adminUserId = adminUser.id;

    // Create the workspace (creator becomes admin automatically).
    const wsRes = await adminAgent
      .post("/api/workspaces")
      .send({ name: "AuthzTest WS", colorIndex: 0 });
    if (wsRes.status !== 201) throw new Error(`workspace creation failed: ${wsRes.status}`);
    workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    // Second user added as editor (direct DB insert for a precise role).
    const { user: editorUser } = await registerAndLogin();
    createdUserIds.push(editorUser.id);
    editorUserId = editorUser.id;
    await db.insert(workspaceMembers).values({ workspaceId, userId: editorUserId, role: "editor" });

    // Third user added as executor — spec: all three roles returned verbatim.
    const { user: executorUser } = await registerAndLogin();
    createdUserIds.push(executorUser.id);
    executorUserId = executorUser.id;
    await db.insert(workspaceMembers).values({ workspaceId, userId: executorUserId, role: "executor" });
  });

  afterAll(async () => {
    if (savedServiceToken !== undefined) {
      process.env.INTERNAL_API_SECRET = savedServiceToken;
    } else {
      delete process.env.INTERNAL_API_SECRET;
    }
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("valid token + admin member → 200 { role: 'admin' }", async () => {
    const res = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", VALID_TOKEN)
      .send({ userId: adminUserId, workspaceId });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
  });

  it("valid token + editor member → 200 { role: 'editor' } (non-admin role preserved)", async () => {
    const res = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", VALID_TOKEN)
      .send({ userId: editorUserId, workspaceId });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("editor");
  });

  it("valid token + executor member → 200 { role: 'executor' } (role preserved verbatim)", async () => {
    const res = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", VALID_TOKEN)
      .send({ userId: executorUserId, workspaceId });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("executor");
  });

  it("valid token + non-member → 200 { role: null }", async () => {
    const { user: stranger } = await registerAndLogin();
    createdUserIds.push(stranger.id);
    const res = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", VALID_TOKEN)
      .send({ userId: stranger.id, workspaceId });
    expect(res.status).toBe(200);
    expect(res.body.role).toBeNull();
  });

  it("reflects a role change immediately — endpoint is UNCACHED (no 30s TTL)", async () => {
    const { user: mutating } = await registerAndLogin();
    createdUserIds.push(mutating.id);
    await db.insert(workspaceMembers).values({ workspaceId, userId: mutating.id, role: "editor" });

    const before = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", VALID_TOKEN)
      .send({ userId: mutating.id, workspaceId });
    expect(before.status).toBe(200);
    expect(before.body.role).toBe("editor");

    // Promote to admin straight in the DB (no app route, no cache invalidation).
    await db
      .update(workspaceMembers)
      .set({ role: "admin" })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, mutating.id)));

    // Immediately after → admin, without waiting the 30s permissionsCache TTL.
    // If the endpoint went through the cached getMemberRole/loadRole, this would
    // still return 'editor' for up to 30s and fail.
    const after = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", VALID_TOKEN)
      .send({ userId: mutating.id, workspaceId });
    expect(after.status).toBe(200);
    expect(after.body.role).toBe("admin");
  });

  it("missing x-internal-secret → 401", async () => {
    const res = await makeAgent().post(ENDPOINT).send({ userId: adminUserId, workspaceId });
    expect(res.status).toBe(401);
  });

  it("wrong x-internal-secret → 401", async () => {
    const res = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", "totally-wrong-token")
      .send({ userId: adminUserId, workspaceId });
    expect(res.status).toBe(401);
  });

  it("valid token + malformed body (non-uuid userId) → 400", async () => {
    const res = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", VALID_TOKEN)
      .send({ userId: "not-a-uuid", workspaceId });
    expect(res.status).toBe(400);
  });

  it("valid token + malformed body (non-uuid workspaceId) → 400", async () => {
    const res = await makeAgent()
      .post(ENDPOINT)
      .set("x-internal-secret", VALID_TOKEN)
      .send({ userId: adminUserId, workspaceId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });

  it("secret env unset → 503 (fail-closed, requireInternal guard)", async () => {
    const saved = process.env.INTERNAL_API_SECRET;
    delete process.env.INTERNAL_API_SECRET;
    try {
      const res = await makeAgent()
        .post(ENDPOINT)
        .set("x-internal-secret", VALID_TOKEN)
        .send({ userId: adminUserId, workspaceId });
      expect(res.status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.INTERNAL_API_SECRET = saved;
    }
  });
});
