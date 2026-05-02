import { db } from "@workspace/db";
import { cards } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export type VisualStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "overdue"
  | "blocked"
  | "draft"
  | "no_task";

/**
 * Parses an `YYYY-MM-DD` (or full ISO) string into a `Date` anchored at noon
 * UTC, avoiding off-by-one timezone shifts when the value is later rendered
 * back as a calendar date. Returns `null` for empty/missing input.
 */
export function parseDateNoon(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  const d = new Date(dateOnly + "T12:00:00.000Z");
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Maps a task `(status, overdue)` pair to the visual status displayed on the
 * canvas card. `overdue` wins over the raw status unless the task is in a
 * terminal/inert state (`completed`, `blocked`, `draft`). Unknown raw statuses
 * fall back to `"pending"`.
 */
export function toVisualStatus(status: string, overdue: boolean): VisualStatus {
  if (
    overdue &&
    status !== "completed" &&
    status !== "blocked" &&
    status !== "draft"
  ) {
    return "overdue";
  }
  const validStatuses = [
    "pending",
    "in_progress",
    "completed",
    "overdue",
    "blocked",
    "draft",
  ] as const;
  type ValidStatus = (typeof validStatuses)[number];
  return validStatuses.includes(status as ValidStatus)
    ? (status as ValidStatus)
    : "pending";
}

/**
 * Persists the computed visual status onto the card backing the given task.
 * No-ops silently when no card references the task (orphaned task).
 */
export async function syncCardVisual(
  taskId: string,
  status: string,
  overdue: boolean,
): Promise<void> {
  const visual = toVisualStatus(status, overdue);
  await db
    .update(cards)
    .set({ statusVisual: visual, updatedAt: new Date() })
    .where(eq(cards.taskId, taskId));
}
