import pg from "../lib/db/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const taskId = process.argv[2];
const workspaceId = process.argv[3];
if (!taskId || !workspaceId) {
  console.error("usage: node smoke-set-task-workspace.mjs <taskId> <workspaceId>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
const r = await client.query(
  "UPDATE tasks SET workspace_id = $1 WHERE id = $2 RETURNING id, workspace_id, title",
  [workspaceId, taskId],
);
console.log(JSON.stringify(r.rows, null, 2));
await client.end();
