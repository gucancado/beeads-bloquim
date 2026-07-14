import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser } from "./helpers";
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
