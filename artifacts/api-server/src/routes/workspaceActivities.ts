import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, taskActivities, users } from "@workspace/db/schema";
import { eq, and, or, lt, gte, inArray, sql, desc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { parseSinceParam, parseUntilParam } from "../lib/queryDates";
import { encodeCursor, decodeCursor } from "../lib/keysetCursor";

const VALID_TYPES = [
  "task_created", "assignee_changed", "owner_changed", "status_changed",
  "priority_changed", "due_date_changed", "approval_comment", "task_approved",
  "task_rejected", "task_duplicated", "checklist_items_added", "task_moved",
  "task_link_created", "task_link_removed", "attachment_promoted",
  "attachment_demoted", "attachment_unlinked", "attachment_added", "attachment_removed",
] as const;
type ValidType = (typeof VALID_TYPES)[number];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router: IRouter = Router({ mergeParams: true });

// Feed de atividade a nível workspace. task_activities não tem workspace_id —
// o JOIN com tasks filtra; escala atual (≤500 tasks/ws) não justifica
// desnormalizar (ver spec 2026-07-10).
router.get("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const q = req.query as { since?: string; until?: string; types?: string; actorId?: string; cursor?: string; limit?: string };

  const since = parseSinceParam(q.since);
  const until = parseUntilParam(q.until);
  if (since === "invalid" || until === "invalid") {
    res.status(400).json({ error: "Validation error", message: "since/until devem ser ISO 8601 ou YYYY-MM-DD" });
    return;
  }
  const types = (q.types ? q.types.split(",").filter(Boolean) : []) as string[];
  const invalidTypes = types.filter((t) => !VALID_TYPES.includes(t as ValidType));
  if (invalidTypes.length > 0) {
    res.status(400).json({ error: "Validation error", message: `types inválidos: ${invalidTypes.join(", ")}` });
    return;
  }
  if (q.actorId && !UUID_REGEX.test(q.actorId)) {
    res.status(400).json({ error: "Validation error", message: "actorId inválido" });
    return;
  }
  const limit = Math.min(Math.max(parseInt(q.limit ?? "50", 10) || 50, 1), 200);
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cursor) {
    res.status(400).json({ error: "Validation error", message: "cursor inválido" });
    return;
  }

  // pg timestamp tem µs; o cursor viaja em ms — truncar no SQL para a
  // igualdade do desempate casar (bug-trap TIMESTAMPTZ µs × JS ms).
  //
  // task_activities.created_at é `timestamp` SEM tz. drizzle lê essas colunas
  // tratando os dígitos armazenados como UTC (mapFromDriverValue faz
  // `value + "+0000"`) e ESCREVE via `mapToDriverValue` = `.toISOString()`
  // (também UTC) — mas isso só roda para valores passados pelos helpers
  // (eq/lt/gte/...). Um `Date` interpolado cru dentro de um template `sql`
  // NÃO passa por esse mapper: cai no serializador padrão do node-postgres
  // (`dateToString`), que usa o fuso horário LOCAL da máquina/processo. Numa
  // máquina em UTC-3 isso desalinha a comparação em 3h e o cursor nunca mais
  // casa com nenhuma linha (bug real, verificado empiricamente — página 2
  // sempre vinha vazia). Fix: serializar o cursor com `.toISOString()` ANTES
  // de interpolar, replicando exatamente o `mapToDriverValue` da coluna.
  const cursorCreatedAtIso = cursor?.createdAt.toISOString();
  const cursorCond = cursor
    ? or(
        sql`date_trunc('milliseconds', ${taskActivities.createdAt}) < ${cursorCreatedAtIso}::timestamp`,
        and(
          sql`date_trunc('milliseconds', ${taskActivities.createdAt}) = ${cursorCreatedAtIso}::timestamp`,
          lt(taskActivities.id, cursor.id),
        ),
      )
    : undefined;

  const rows = await db
    .select({
      id: taskActivities.id,
      type: taskActivities.type,
      taskId: taskActivities.taskId,
      taskTitle: tasks.title,
      actorId: taskActivities.actorId,
      actorName: users.name,
      actorClasses: users.classes,
      metadata: taskActivities.metadata,
      createdAt: taskActivities.createdAt,
    })
    .from(taskActivities)
    .innerJoin(tasks, eq(tasks.id, taskActivities.taskId))
    .leftJoin(users, eq(users.id, taskActivities.actorId))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        types.length > 0 ? inArray(taskActivities.type, types as ValidType[]) : undefined,
        q.actorId ? eq(taskActivities.actorId, q.actorId) : undefined,
        since ? gte(taskActivities.createdAt, since) : undefined,
        until ? lt(taskActivities.createdAt, until) : undefined,
        cursorCond,
      ),
    )
    // ORDER BY precisa usar a MESMA chave truncada em ms que o predicado do
    // keyset acima (date_trunc('milliseconds', ...)). O cursor só carrega
    // precisão de ms (serializado de um JS Date via .toISOString()), então se
    // o ORDER BY ordenasse pela coluna µs crua, duas linhas no mesmo ms mas
    // com µs diferentes poderiam ordenar de um jeito no SQL e de outro no
    // desempate por id — derrubando uma linha pra sempre na borda da página.
    .orderBy(sql`date_trunc('milliseconds', ${taskActivities.createdAt}) DESC`, desc(taskActivities.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  res.json({
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  });
});

export default router;
