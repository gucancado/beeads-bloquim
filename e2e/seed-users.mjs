// Creates the two fixed e2e users straight in the dev DB, bypassing the
// per-IP register rate limit (same trick as api-server's test helpers).
import pg from "pg";
import bcrypt from "bcryptjs";

const URL = process.env.DATABASE_URL;
if (!URL || URL.includes("ljilttjsrceddoydnneu")) {
  throw new Error("DATABASE_URL must be set and must NOT point at production");
}

const PASSWORD = "E2ePass12345!";
const USERS = [
  { name: "E2E Owner", email: "e2e_tasks_owner@test.local" },
  { name: "E2E Mate", email: "e2e_tasks_mate@test.local" },
];

const client = new pg.Client({ connectionString: URL });
await client.connect();
const hash = await bcrypt.hash(PASSWORD, 12);
for (const u of USERS) {
  const { rows } = await client.query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email`,
    [u.name, u.email, hash],
  );
  console.log("seeded", rows[0].email, rows[0].id);
}
await client.end();
