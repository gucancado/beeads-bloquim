import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { userTaskColumnOrder } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { z } from "zod/v4";

const router: IRouter = Router();

// Keep this list in sync with TASK_COLUMN_KEYS on the frontend
// (lib/taskColumnConstants.ts). Esta é a allowlist usada pra validar o PUT
// — a ordem aqui não importa pro backend, mas espelho o default do frontend
// pra facilitar diffs.
const TASK_COLUMN_KEYS = [
  "status",
  "title",
  "schedule",
  "assignee",
  "workspace_map",
  "checklist",
  "comments",
  "attachments",
  "priority",
] as const;

const taskColumnKeySchema = z.enum(TASK_COLUMN_KEYS);

router.get("/task-columns", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  const rows = await db
    .select({ columnKey: userTaskColumnOrder.columnKey, sortOrder: userTaskColumnOrder.sortOrder })
    .from(userTaskColumnOrder)
    .where(eq(userTaskColumnOrder.userId, userId));

  res.json(rows);
});

const orderSchema = z.object({
  columnKeys: z
    .array(taskColumnKeySchema)
    .refine((keys) => keys.length === new Set(keys).size, {
      message: "columnKeys must not contain duplicate values",
    }),
});

router.put("/task-columns", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { columnKeys } = parsed.data;

  if (columnKeys.length === 0) {
    res.json({ success: true });
    return;
  }

  const values = columnKeys.map((columnKey, idx) => ({
    userId,
    columnKey,
    sortOrder: idx,
  }));

  await db
    .insert(userTaskColumnOrder)
    .values(values)
    .onConflictDoUpdate({
      target: [userTaskColumnOrder.userId, userTaskColumnOrder.columnKey],
      set: { sortOrder: sql`excluded.sort_order` },
    });

  res.json({ success: true });
});

export default router;
