import { z } from "zod/v4";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasks, meetings, workspaceMembers } from "@workspace/db/schema";
import { canActOnMeeting } from "../routes/meetings";
import { ACTIVE_STATUSES } from "./calendarTasksQuery";

/** YYYY-MM-DD que existe no calendário (2030-02-30 → false). */
export function isRealYmd(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const reorderSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealYmd, "data inexistente"),
  items: z.array(z.object({ kind: z.enum(["task", "meeting"]), id: z.string().uuid() })).max(500),
  moved: z.object({
    kind: z.enum(["task", "meeting"]),
    id: z.string().uuid(),
    target: z.enum(["day", "pool"]),
  }).optional(),
});
export type ReorderInput = z.infer<typeof reorderSchema>;

type Result = { status: number; body: unknown };
const bad = (message: string): Result => ({ status: 400, body: { error: "Validation error", message } });

export async function applyCalendarReorder(userId: string, input: ReorderInput): Promise<Result> {
  const keys = input.items.map(i => `${i.kind}:${i.id}`);
  if (new Set(keys).size !== keys.length) return bad("itens duplicados");
  const { moved } = input;
  if (moved) {
    if (moved.kind === "meeting") return bad("reunião não muda de dia pelo calendário");
    if (moved.target === "pool" && input.items.length > 0) return bad("soltar no pool não leva itens");
    if (moved.target === "day" && !keys.includes(`task:${moved.id}`)) return bad("item movido precisa estar na coluna");
  }

  const taskIds = Array.from(new Set([
    ...input.items.filter(i => i.kind === "task").map(i => i.id),
    ...(moved ? [moved.id] : []),
  ]));
  const meetingIds = input.items.filter(i => i.kind === "meeting").map(i => i.id);

  const taskRows = taskIds.length
    ? await db.select({ id: tasks.id, workspaceId: tasks.workspaceId, assignedTo: tasks.assignedTo, status: tasks.status })
        .from(tasks).where(inArray(tasks.id, taskIds))
    : [];
  if (taskRows.length !== taskIds.length) return { status: 404, body: { message: "Tarefa não encontrada" } };

  const wsIds = Array.from(new Set(taskRows.map(t => t.workspaceId).filter((w): w is string => !!w)));
  const memberOf = new Set(
    wsIds.length
      ? (await db.select({ workspaceId: workspaceMembers.workspaceId }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.workspaceId, wsIds))))
          .map(m => m.workspaceId)
      : [],
  );
  for (const t of taskRows) {
    const allowed = t.workspaceId ? memberOf.has(t.workspaceId) : t.assignedTo === userId;
    if (!allowed) return { status: 403, body: { message: "Sem permissão" } };
  }
  if (moved) {
    const m = taskRows.find(t => t.id === moved.id)!;
    if (!(ACTIVE_STATUSES as readonly string[]).includes(m.status)) return bad("tarefa concluída/cancelada não muda de dia");
  }

  const meetingRows = meetingIds.length ? await db.select().from(meetings).where(inArray(meetings.id, meetingIds)) : [];
  if (meetingRows.length !== meetingIds.length) return { status: 404, body: { message: "Reunião não encontrada" } };
  for (const m of meetingRows) {
    if (!(await canActOnMeeting(userId, m))) return { status: 403, body: { message: "Sem permissão" } };
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      if (item.kind === "meeting") {
        await tx.update(meetings).set({ plannedOrder: i }).where(eq(meetings.id, item.id));
      } else if (moved?.target === "day" && moved.id === item.id) {
        await tx.update(tasks).set({ plannedOrder: i, plannedDate: input.date }).where(eq(tasks.id, item.id));
      } else {
        await tx.update(tasks).set({ plannedOrder: i }).where(eq(tasks.id, item.id));
      }
    }
    if (moved?.target === "pool") {
      await tx.update(tasks).set({ plannedDate: null, plannedOrder: null }).where(eq(tasks.id, moved.id));
    }
  });
  return { status: 200, body: { ok: true } };
}
