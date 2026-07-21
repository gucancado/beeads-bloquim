import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { db } from "@workspace/db";
import { meetings, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { extractMeetCode } from "../routes/meetings";
import { isMeetingsAgendaEnabled } from "../lib/featureFlags";
import { startScheduler } from "../scheduler";

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

// B6: gate + wiring dos crons de agenda no scheduler. O gate é estrito e
// composto; com ele OFF (default) o startScheduler não pode acoplar nenhum
// interval de agenda nem quebrar o boot.
describe("agenda de reuniões — gate MEETINGS_AGENDA_ENABLED + wiring do scheduler", () => {
  const GATE_ENVS = [
    "MEETINGS_AGENDA_ENABLED",
    "MEETINGS_ENABLED",
    "WORKER_URL",
    "WORKER_PANEL_TOKEN",
    "GOOGLE_CALENDAR_ENABLED",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of GATE_ENVS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of GATE_ENVS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function enableAll() {
    process.env.MEETINGS_AGENDA_ENABLED = "true";
    process.env.MEETINGS_ENABLED = "true";
    process.env.WORKER_URL = "http://worker.invalid";
    process.env.WORKER_PANEL_TOKEN = "t";
    process.env.GOOGLE_CALENDAR_ENABLED = "true";
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "csecret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://app.invalid/cb";
  }

  it("default OFF: sem a flag, o gate é false mesmo com tudo o mais habilitado", () => {
    enableAll();
    delete process.env.MEETINGS_AGENDA_ENABLED;
    expect(isMeetingsAgendaEnabled()).toBe(false);
  });

  it("gate estrito: 'TRUE'/'1' não ligam (só '===\"true\"')", () => {
    enableAll();
    process.env.MEETINGS_AGENDA_ENABLED = "TRUE";
    expect(isMeetingsAgendaEnabled()).toBe(false);
    process.env.MEETINGS_AGENDA_ENABLED = "1";
    expect(isMeetingsAgendaEnabled()).toBe(false);
  });

  it("composto: exige reuniões E Google Calendar, não só a flag da agenda", () => {
    enableAll();
    delete process.env.MEETINGS_ENABLED; // reuniões off
    expect(isMeetingsAgendaEnabled()).toBe(false);
    enableAll();
    delete process.env.GOOGLE_CALENDAR_ENABLED; // gcal off
    expect(isMeetingsAgendaEnabled()).toBe(false);
  });

  it("liga só com agenda + reuniões + Google Calendar todos habilitados", () => {
    enableAll();
    expect(isMeetingsAgendaEnabled()).toBe(true);
  });

  it("boot com gate OFF: startScheduler não quebra e não acopla crons de agenda", () => {
    delete process.env.MEETINGS_AGENDA_ENABLED; // default OFF
    const spy = vi.spyOn(global, "setInterval");
    expect(() => startScheduler()).not.toThrow();
    // Só os 2 intervals base (overdue + activate); nenhum de agenda com o gate OFF.
    expect(spy).toHaveBeenCalledTimes(2);
    for (const r of spy.mock.results) clearInterval(r.value as ReturnType<typeof setInterval>);
    spy.mockRestore();
  });
});
