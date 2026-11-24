import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { makeAgent, registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

const VALID_TOKEN = "test-internal-api-secret-tasks";

describe("GET /api/internal/workspaces/:id/tasks", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  let workspaceId: string;
  let savedServiceToken: string | undefined;

  beforeAll(async () => {
    savedServiceToken = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = VALID_TOKEN;

    const { agent, user } = await registerAndLogin();
    createdUserIds.push(user.id);
    const wsRes = await agent.post("/api/workspaces").send({ name: "Tarefas Smoke", colorIndex: 0 });
    if (wsRes.status !== 201) throw new Error(`workspace creation failed: ${wsRes.status}`);
    workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);

    const mk = async (title: string) => {
      const r = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title });
      if (r.status !== 201) throw new Error(`task creation failed: ${r.status}`);
      return r.body.id as string;
    };
    await mk("aberta");
    const done = await mk("feita");
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${done}/status`).send({ status: "completed" });
  });

  afterAll(async () => {
    if (savedServiceToken !== undefined) process.env.INTERNAL_API_SECRET = savedServiceToken;
    else delete process.env.INTERNAL_API_SECRET;
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  const url = (since: string) => `/api/internal/workspaces/${workspaceId}/tasks?completedSince=${since}`;

  it("separa abertas e concluídas desde a data", async () => {
    const res = await makeAgent().get(url("2000-01-01T00:00:00Z")).set("x-internal-secret", VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.open.map((t: { title: string }) => t.title)).toEqual(["aberta"]);
    expect(res.body.completed.map((t: { title: string }) => t.title)).toEqual(["feita"]);
  });

  it("concluída antes de completedSince fica fora", async () => {
    const res = await makeAgent().get(url("2999-01-01T00:00:00Z")).set("x-internal-secret", VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.completed).toEqual([]);
  });

  it("completedSince inválido → 400", async () => {
    const res = await makeAgent().get(url("lixo")).set("x-internal-secret", VALID_TOKEN);
    expect(res.status).toBe(400);
  });

  it("sem segredo → 401", async () => {
    const res = await makeAgent().get(url("2000-01-01T00:00:00Z"));
    expect(res.status).toBe(401);
  });
});
