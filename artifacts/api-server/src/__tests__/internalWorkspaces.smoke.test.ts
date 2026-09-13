import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { makeAgent, registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

const ENDPOINT = "/api/internal/workspaces";
const VALID_TOKEN = "test-internal-api-secret-workspaces";

describe("GET /api/internal/workspaces", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  let workspaceId: string;
  let savedServiceToken: string | undefined;

  beforeAll(async () => {
    // `requireInternal` lê o env por request — setar aqui vale para a suíte.
    savedServiceToken = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = VALID_TOKEN;

    const { agent, user } = await registerAndLogin();
    createdUserIds.push(user.id);

    const wsRes = await agent.post("/api/workspaces").send({ name: "Pousada Smoke", colorIndex: 0 });
    if (wsRes.status !== 201) throw new Error(`workspace creation failed: ${wsRes.status}`);
    workspaceId = wsRes.body.id as string;
    createdWorkspaceIds.push(workspaceId);
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

  it("valid token → 200 com id e nome do workspace", async () => {
    const res = await makeAgent().get(`${ENDPOINT}?ids=${workspaceId}`).set("x-internal-secret", VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workspaces: [{ id: workspaceId, name: "Pousada Smoke" }] });
  });

  it("ignora id malformado e id inexistente", async () => {
    const res = await makeAgent()
      .get(`${ENDPOINT}?ids=nao-e-uuid,00000000-0000-0000-0000-000000000000,${workspaceId}`)
      .set("x-internal-secret", VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.workspaces.map((w: { id: string }) => w.id)).toEqual([workspaceId]);
  });

  it("sem ids → 200 com lista vazia", async () => {
    const res = await makeAgent().get(ENDPOINT).set("x-internal-secret", VALID_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ workspaces: [] });
  });

  it("missing x-internal-secret → 401", async () => {
    const res = await makeAgent().get(`${ENDPOINT}?ids=${workspaceId}`);
    expect(res.status).toBe(401);
  });

  it("wrong x-internal-secret → 401", async () => {
    const res = await makeAgent().get(`${ENDPOINT}?ids=${workspaceId}`).set("x-internal-secret", "totally-wrong-token");
    expect(res.status).toBe(401);
  });
});
