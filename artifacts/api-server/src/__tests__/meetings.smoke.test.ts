import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { db } from "@workspace/db";
import { meetings, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { extractMeetCode } from "../routes/meetings";

describe("extractMeetCode", () => {
  it("extrai de URL e de código cru", () => {
    expect(extractMeetCode("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
    expect(extractMeetCode("abc-defg-hij")).toBe("abc-defg-hij");
    expect(extractMeetCode("  abc-defg-hij  ")).toBe("abc-defg-hij");
  });
  it("retorna null pra entrada inválida", () => {
    expect(extractMeetCode("não é código")).toBeNull();
    expect(extractMeetCode("ABC-DEFG-HIJ")).toBeNull(); // maiúsculas fora do padrão
  });
});

describe("POST /api/meetings — validação e auth", () => {
  const ids: string[] = [];
  afterAll(async () => { for (const id of ids) await deleteUser(id); });

  it("401 sem auth", async () => {
    const { makeAgent } = await import("./helpers");
    const r = await makeAgent().post("/api/meetings").send({ meetUrlOrCode: "abc-defg-hij" });
    expect([401, 503]).toContain(r.status); // 503 se flag off; 401 se flag on e sem cookie
  });

  it("400 código inválido (com flag ligada)", async () => {
    process.env.MEETINGS_ENABLED = "true";
    process.env.WORKER_URL = "http://worker.invalid";
    process.env.WORKER_PANEL_TOKEN = "t";
    const { agent, user } = await registerAndLogin();
    ids.push(user.id);
    const r = await agent.post("/api/meetings").send({ meetUrlOrCode: "não-é-código" });
    expect(r.status).toBe(400);
  });
});

// A agenda (my-tasks) é cross-workspace: chama GET /api/meetings sem workspaceId.
// A lista precisa cobrir standalone + reuniões dos workspaces do usuário, senão
// a reunião some da UI e o poll-through (syncFromWorker) nunca roda.
describe("GET /api/meetings sem workspaceId — lista da agenda", () => {
  const userIds: string[] = [];
  const wsIds: string[] = [];
  const meetingIds: string[] = [];
  afterAll(async () => {
    for (const id of meetingIds) await db.delete(meetings).where(eq(meetings.id, id));
    await deleteWorkspaces(wsIds);
    for (const id of userIds) await deleteUser(id);
  });

  it("inclui reunião de workspace do qual o usuário é membro, e não a de workspace alheio", async () => {
    process.env.MEETINGS_ENABLED = "true";
    process.env.WORKER_URL = "http://worker.invalid";
    process.env.WORKER_PANEL_TOKEN = "t";

    const { agent, user } = await registerAndLogin();
    const outsider = await registerAndLogin("Outsider");
    userIds.push(user.id, outsider.user.id);

    const [ws] = await db.insert(workspaces).values({ name: "WS Agenda", createdBy: user.id }).returning();
    const [alien] = await db.insert(workspaces).values({ name: "WS Alheio", createdBy: outsider.user.id }).returning();
    wsIds.push(ws.id, alien.id);
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: "admin" });
    await db.insert(workspaceMembers).values({ workspaceId: alien.id, userId: outsider.user.id, role: "admin" });

    const [withWs] = await db.insert(meetings)
      .values({ workspaceId: ws.id, createdBy: user.id, meetCode: "aaa-bbbb-ccc", status: "collecting" }).returning();
    const [standalone] = await db.insert(meetings)
      .values({ workspaceId: null, createdBy: user.id, meetCode: "ddd-eeee-fff", status: "transcribed" }).returning();
    const [alienMeeting] = await db.insert(meetings)
      .values({ workspaceId: alien.id, createdBy: outsider.user.id, meetCode: "ggg-hhhh-iii", status: "collecting" }).returning();
    meetingIds.push(withWs.id, standalone.id, alienMeeting.id);

    const r = await agent.get("/api/meetings");
    expect(r.status).toBe(200);
    const codes = (r.body as Array<{ meetCode: string }>).map(m => m.meetCode);
    expect(codes).toContain("aaa-bbbb-ccc"); // do workspace do usuário — some hoje (bug)
    expect(codes).toContain("ddd-eeee-fff"); // standalone
    expect(codes).not.toContain("ggg-hhhh-iii"); // workspace alheio: não pode vazar
  });
});
