import pg from "../lib/db/node_modules/pg/lib/index.js";

const URL = "postgresql://neondb_owner:npg_wdBc5sgQ4vEt@ep-small-heart-akp4m07b.c-3.us-west-2.aws.neon.tech/neondb?sslmode=require";

const c = new pg.Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
await c.connect();

async function q(sql, params) {
  try {
    const r = await c.query(sql, params);
    return r.rows;
  } catch (e) {
    return { error: e.message };
  }
}

const out = {};

out.identity = await q("SELECT current_database() AS db, current_user AS usr, version() AS v, pg_size_pretty(pg_database_size(current_database())) AS size");

out.tables = (await q("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(r => r.tablename);

const counts = {};
for (const t of [
  "users","workspaces","workspace_members","maps","cards","card_connections",
  "tasks","subtasks","task_comments","task_activities",
  "task_templates","task_template_subtasks",
  "attachments","file_uploads","attachment_links",
  "map_text_elements","map_shapes","map_visited",
  "user_map_access","user_workspace_order",
  "user_google_calendar_accounts","user_calendar_preferences",
]) {
  const r = await q(`SELECT COUNT(*)::int AS n FROM ${t}`);
  counts[t] = Array.isArray(r) ? r[0].n : `ERR: ${r.error}`;
}
out.counts = counts;

out.tasks_approval = (await q("SELECT COUNT(*)::int AS n FROM tasks WHERE is_approval_task = true"))[0]?.n;

out.recent = {
  last_task_created: (await q("SELECT MAX(created_at) AS t FROM tasks"))[0]?.t,
  last_task_updated: (await q("SELECT MAX(updated_at) AS t FROM tasks"))[0]?.t,
  last_task_activity: (await q("SELECT MAX(created_at) AS t FROM task_activities"))[0]?.t,
  last_user_created: (await q("SELECT MAX(created_at) AS t FROM users"))[0]?.t,
  last_workspace_created: (await q("SELECT MAX(created_at) AS t FROM workspaces"))[0]?.t,
  last_file_upload: (await q("SELECT MAX(created_at) AS t FROM file_uploads"))[0]?.t,
};

out.file_uploads_total_bytes = (await q("SELECT COALESCE(SUM(file_size),0)::bigint AS b FROM file_uploads"))[0]?.b;

out.attachment_links_breakdown = await q(
  "SELECT entity_type, COUNT(*)::int AS n FROM attachment_links GROUP BY entity_type ORDER BY n DESC"
);

out.workspaces_top = await q(
  "SELECT w.name, COUNT(t.id)::int AS task_count FROM workspaces w LEFT JOIN tasks t ON t.workspace_id = w.id GROUP BY w.id, w.name ORDER BY task_count DESC LIMIT 20"
);

console.log(JSON.stringify(out, null, 2));
await c.end();
