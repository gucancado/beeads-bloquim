import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request, { type Agent } from "supertest";
import { db } from "@workspace/db";
import { users, workspaces } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import app from "../app";

export type TestUser = {
  email: string;
  password: string;
  name: string;
  id: string;
};

export function makeAgent(): Agent {
  return request.agent(app);
}

/**
 * Creates a user directly in the database (bypassing the rate-limited
 * register endpoint) and logs them in via the real auth flow. Used by tests
 * that need many fresh users without hitting the per-IP register quota.
 */
export async function registerAndLogin(): Promise<{
  agent: Agent;
  user: TestUser;
}> {
  const email = `smoke_${randomUUID()}@test.local`;
  const password = "Smoke12345!";
  const name = "Smoke Tester";

  const passwordHash = await bcrypt.hash(password, 12);
  const [created] = await db
    .insert(users)
    .values({ name, email, passwordHash })
    .returning();

  const agent = makeAgent();
  const login = await agent
    .post("/api/auth/login")
    .send({ email, password });
  if (login.status !== 200) {
    throw new Error(
      `login failed: status=${login.status} body=${JSON.stringify(login.body)}`,
    );
  }

  return {
    agent,
    user: { email, password, name, id: created.id },
  };
}

export async function deleteUser(userId: string): Promise<void> {
  if (!userId) return;
  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Deletes the given workspaces. Schema cascades through to maps, members,
 * cards, connections, tasks, approvals, attachments and activities, so this
 * is enough to clean up everything a smoke test created on a workspace.
 */
export async function deleteWorkspaces(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(workspaces).where(inArray(workspaces.id, ids));
}
