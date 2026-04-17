import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser } from "./helpers";

describe("workspace + map + task smoke", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("create workspace -> create map -> create card -> create task -> read related", async () => {
    const { agent, user } = await registerAndLogin();
    createdUserIds.push(user.id);

    // create workspace
    const wsRes = await agent
      .post("/api/workspaces")
      .send({ name: "Smoke WS", colorIndex: 0 });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.id as string;
    expect(workspaceId).toBeTruthy();
    expect(wsRes.body.role).toBe("admin");

    // list workspaces - the new one must appear
    const wsList = await agent.get("/api/workspaces");
    expect(wsList.status).toBe(200);
    expect(Array.isArray(wsList.body)).toBe(true);
    expect(wsList.body.find((w: { id: string }) => w.id === workspaceId)).toBeTruthy();

    // create map
    const mapRes = await agent
      .post(`/api/workspaces/${workspaceId}/maps`)
      .send({ name: "Smoke Map" });
    expect(mapRes.status).toBe(201);
    const mapId = mapRes.body.id as string;
    expect(mapId).toBeTruthy();

    // open map (uses idx_cards_map + idx_card_connections_map)
    const openMap = await agent.get(
      `/api/workspaces/${workspaceId}/maps/${mapId}`,
    );
    expect(openMap.status).toBe(200);
    expect(openMap.body.id).toBe(mapId);
    expect(Array.isArray(openMap.body.cards)).toBe(true);
    expect(Array.isArray(openMap.body.connections)).toBe(true);

    // create card on the map
    const cardRes = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Smoke Card", positionX: 0, positionY: 0 });
    expect(cardRes.status).toBe(201);
    expect(cardRes.body.id).toBeTruthy();
    expect(cardRes.body.mapId).toBe(mapId);

    // create task in workspace
    const taskRes = await agent
      .post(`/api/workspaces/${workspaceId}/tasks`)
      .send({ title: "Smoke Task", priority: "medium" });
    expect(taskRes.status).toBe(201);
    const taskId = taskRes.body.id as string;
    expect(taskId).toBeTruthy();

    // list my tasks - empty (task has no assignee)
    const myTasks0 = await agent.get("/api/my-tasks");
    expect(myTasks0.status).toBe(200);
    expect(Array.isArray(myTasks0.body)).toBe(true);

    // assign the task to self so it shows up in my-tasks
    const assignRes = await agent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
      .send({ assignedTo: user.id });
    expect([200, 204]).toContain(assignRes.status);

    // list my tasks - should now include the task
    const myTasks1 = await agent.get("/api/my-tasks");
    expect(myTasks1.status).toBe(200);
    expect(
      myTasks1.body.find((t: { id: string }) => t.id === taskId),
    ).toBeTruthy();

    // read comments / attachments / activities (workspace admin route)
    const comments = await agent.get(
      `/api/workspaces/${workspaceId}/tasks/${taskId}/comments`,
    );
    expect(comments.status).toBe(200);
    expect(Array.isArray(comments.body)).toBe(true);

    const attachments = await agent.get(
      `/api/workspaces/${workspaceId}/tasks/${taskId}/attachments`,
    );
    expect(attachments.status).toBe(200);
    expect(Array.isArray(attachments.body)).toBe(true);

    const activities = await agent.get(
      `/api/workspaces/${workspaceId}/tasks/${taskId}/activities`,
    );
    expect(activities.status).toBe(200);
    expect(Array.isArray(activities.body)).toBe(true);
    // task_created activity should be present
    expect(
      activities.body.find(
        (a: { type: string }) => a.type === "task_created",
      ),
    ).toBeTruthy();
  });
});
