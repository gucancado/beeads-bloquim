import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const poolMax = Number(process.env.DB_POOL_MAX ?? 20);
const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000);
const idleTxTimeoutMs = Number(process.env.DB_IDLE_TX_TIMEOUT_MS ?? 30_000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  // Drop a connection that the server hasn't said anything on for 30s.
  idleTimeoutMillis: 30_000,
  // Prevent a slow query from owning a pool slot indefinitely.
  statement_timeout: statementTimeoutMs,
  idle_in_transaction_session_timeout: idleTxTimeoutMs,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
