import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser } from "./helpers";

describe("GET /api/integrations/google-calendar/events", () => {
  const KEYS = ["GOOGLE_CALENDAR_ENABLED", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"] as const;
  const saved: Record<string, string | undefined> = {};
  let userId = "";

  afterAll(async () => {
    await deleteUser(userId);
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it("400 em intervalo inválido ou > 31 dias; 404 sem conta conectada", async () => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.GOOGLE_CALENDAR_ENABLED = "true";
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost/cb";
    const { agent, user } = await registerAndLogin();
    userId = user.id;
    const now = Date.now();
    const q = (a: number, b: number) =>
      `from=${encodeURIComponent(new Date(now + a).toISOString())}&to=${encodeURIComponent(new Date(now + b).toISOString())}&tz=America%2FSao_Paulo`;
    const base = "/api/integrations/google-calendar/events";
    expect((await agent.get(`${base}?from=xx&to=yy`)).status).toBe(400);
    expect((await agent.get(`${base}?${q(0, 40 * 86_400_000)}`)).status).toBe(400);
    expect((await agent.get(`${base}?${q(0, -1000)}`)).status).toBe(400);
    expect((await agent.get(`${base}?${q(0, 7 * 86_400_000)}`)).status).toBe(404);
  });
});
