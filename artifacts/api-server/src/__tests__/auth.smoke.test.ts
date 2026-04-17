import { describe, it, expect, afterAll } from "vitest";
import { makeAgent, registerAndLogin, deleteUser } from "./helpers";

describe("auth smoke", () => {
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdUserIds) await deleteUser(id);
  });

  it("register -> /me -> logout -> /me 401 -> login -> /me", async () => {
    const { agent, user } = await registerAndLogin();
    createdUserIds.push(user.id);

    // /me after register (cookie persisted by agent)
    const me1 = await agent.get("/api/auth/me");
    expect(me1.status).toBe(200);
    expect(me1.body.id).toBe(user.id);
    expect(me1.body.email).toBe(user.email);

    // logout
    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(200);

    // /me must now be 401 on the same agent
    const meAfterLogout = await agent.get("/api/auth/me");
    expect(meAfterLogout.status).toBe(401);

    // login again on a fresh agent
    const fresh = makeAgent();
    const login = await fresh
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(user.id);

    const me2 = await fresh.get("/api/auth/me");
    expect(me2.status).toBe(200);
    expect(me2.body.id).toBe(user.id);
  });

  it("rejects /me without cookie", async () => {
    const fresh = makeAgent();
    const res = await fresh.get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects login with wrong password", async () => {
    const { user } = await registerAndLogin();
    createdUserIds.push(user.id);

    const fresh = makeAgent();
    const res = await fresh
      .post("/api/auth/login")
      .send({ email: user.email, password: "WrongPass123!" });
    expect(res.status).toBe(401);
  });
});
