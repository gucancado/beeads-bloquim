import { Router, IRouter } from "express";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { workspaceMembers } from "@workspace/db/schema";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import {
  CALENDAR_STATUSES, TODOS_STATUSES, listCalendarTasks, type CalendarStatus,
} from "../services/calendarTasksQuery";

const router: IRouter = Router();
const MAX_RANGE_MS = 31 * 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tasksQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  workspaceId: z.string().uuid().optional(),
});

export function parseRange(fromRaw: string, toRaw: string): { from: Date; to: Date } | null {
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to.getTime() <= from.getTime() || to.getTime() - from.getTime() > MAX_RANGE_MS) return null;
  return { from, to };
}

// GET /api/calendar/tasks — tarefas da semana do modo calendário.
router.get("/tasks", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = tasksQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  const range = parseRange(parsed.data.from, parsed.data.to);
  if (!range) return res.status(400).json({ error: "Validation error", message: "from/to inválidos (ISO, to > from, máx 31 dias)" });

  const rawStatuses = parsed.data.status ? parsed.data.status.split(",").filter(Boolean) : [];
  if (rawStatuses.some(s => !(CALENDAR_STATUSES as readonly string[]).includes(s))) {
    return res.status(400).json({ error: "Validation error", message: `status aceita: ${CALENDAR_STATUSES.join(", ")}` });
  }
  const statuses = rawStatuses.length > 0 ? (rawStatuses as CalendarStatus[]) : TODOS_STATUSES;
  const assignees = parsed.data.assignedTo !== undefined ? parsed.data.assignedTo.split(",").filter(Boolean) : ["me"];
  if (assignees.some(a => a !== "me" && a !== "unassigned" && !UUID_RE.test(a))) {
    return res.status(400).json({ error: "Validation error", message: "assignedTo aceita: me, unassigned ou uuid" });
  }

  const workspaceId = parsed.data.workspaceId ?? null;
  if (workspaceId) {
    const [m] = await db.select({ id: workspaceMembers.id }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1);
    if (!m) return res.status(403).json({ message: "Sem permissão" });
  }

  const rows = await listCalendarTasks({ userId, workspaceId, statuses, assignees, from: range.from, to: range.to });
  return res.json(rows);
});

export default router;
