import { randomUUID } from "node:crypto";
import request, { type Agent } from "supertest";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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

export async function registerAndLogin(): Promise<{
  agent: Agent;
  user: TestUser;
}> {
  const agent = makeAgent();
  const email = `smoke_${randomUUID()}@test.local`;
  const password = "Smoke12345!";
  const name = "Smoke Tester";

  const res = await agent
    .post("/api/auth/register")
    .send({ email, password, name });

  if (res.status !== 201) {
    throw new Error(
      `register failed: status=${res.status} body=${JSON.stringify(res.body)}`,
    );
  }

  return {
    agent,
    user: { email, password, name, id: res.body.user.id as string },
  };
}

export async function deleteUser(userId: string): Promise<void> {
  if (!userId) return;
  await db.delete(users).where(eq(users.id, userId));
}
