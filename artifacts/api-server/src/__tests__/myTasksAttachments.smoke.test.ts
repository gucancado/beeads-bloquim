import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser } from "./helpers";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await deleteUser(id).catch(() => {});
  }
});

/**
 * Regression coverage for `/api/my-tasks/:taskId/attachments` authorisation.
 * A personal task created by user A must not expose its attachment surface
 * (list / create / delete / download) to user B, even when authenticated.
 *
 * Expected contract (preserved from current behaviour, now consolidated in
 * `authorizePersonalTaskAccess`):
 *   - task does not exist               -> 404 { error: "Not found" }
 *   - task belongs to someone else      -> 403 { error: "Forbidden" }
 *   - task is a workspace task          -> 400 (uses workspace endpoint)
 */
describe("myTasks attachments authorization", () => {
  it("blocks user B from accessing user A's personal task attachments", async () => {
    const a = await registerAndLogin();
    createdUserIds.push(a.user.id);
    const b = await registerAndLogin();
    createdUserIds.push(b.user.id);

    // user A creates a personal task (workspaceId=null, assignedTo=A)
    const create = await a.agent
      .post("/api/my-tasks")
      .send({ title: "A's private task", priority: "medium" });
    expect(create.status).toBe(201);
    expect(create.body.workspaceId).toBeNull();
    expect(create.body.assignedTo).toBe(a.user.id);
    const taskId = create.body.id as string;

    // sanity: A can list attachments (empty)
    const aList = await a.agent.get(`/api/my-tasks/${taskId}/attachments`);
    expect(aList.status).toBe(200);
    expect(Array.isArray(aList.body)).toBe(true);
    expect(aList.body.length).toBe(0);

    // user B is logged in but is not the assignee → the surviving routes
    // must 403. (POST /my-tasks/:tId/attachments was removed in favour of
    // /api/storage/uploads/request-url; auth on that flow is enforced via
    // userIsWorkspaceMember on the storage route, not exercised here.)
    const bList = await b.agent.get(`/api/my-tasks/${taskId}/attachments`);
    expect(bList.status).toBe(403);
    expect(bList.body.error).toBe("Forbidden");

    const fakeAttachmentId = "00000000-0000-0000-0000-000000000000";
    const bDelete = await b.agent.delete(
      `/api/my-tasks/${taskId}/attachments/${fakeAttachmentId}`,
    );
    expect(bDelete.status).toBe(403);
    expect(bDelete.body.error).toBe("Forbidden");

    const bDownload = await b.agent.get(
      `/api/my-tasks/${taskId}/attachments/${fakeAttachmentId}/download`,
    );
    expect(bDownload.status).toBe(403);
    expect(bDownload.body.error).toBe("Forbidden");

    // user A's view is unaffected
    const aListAfter = await a.agent.get(`/api/my-tasks/${taskId}/attachments`);
    expect(aListAfter.status).toBe(200);
    expect(aListAfter.body.length).toBe(0);
  });
});
