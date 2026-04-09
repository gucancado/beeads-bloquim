import { db } from "@workspace/db";
import { tasks, subtasks, taskActivities } from "@workspace/db/schema";
import type { RecurrenceConfig } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { computeOverdue } from "./overdue";

type TaskPriority = "low" | "medium" | "high" | "critical";

interface RecurringTaskSource {
  id: string;
  workspaceId: string | null;
  title: string;
  description: string | null;
  assignedTo: string | null;
  priority: string | null;
  recurrenceConfig: unknown;
}

const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];

function toValidPriority(value: string | null | undefined): TaskPriority {
  if (value && VALID_PRIORITIES.includes(value as TaskPriority)) {
    return value as TaskPriority;
  }
  return "medium";
}

/**
 * Duplicate a recurring task when it transitions to completed, producing a new
 * pending task with the next due date and resetting subtasks to incomplete.
 * Uses a DB transaction for atomicity (same pattern as POST /:taskId/duplicate).
 */
export async function duplicateRecurringTask(
  original: RecurringTaskSource,
  nextDueDate: Date | null,
  actorId: string,
  workspaceId: string | undefined,
): Promise<void> {
  await db.transaction(async (tx) => {
    const originalSubtasks = await tx
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, original.id))
      .orderBy(asc(subtasks.order), asc(subtasks.createdAt));

    const [newTask] = await tx.insert(tasks).values({
      workspaceId: original.workspaceId,
      mapId: null,
      title: original.title,
      description: original.description,
      assignedTo: original.assignedTo,
      priority: toValidPriority(original.priority),
      status: "in_progress",
      overdue: computeOverdue(nextDueDate, "in_progress"),
      dueDate: nextDueDate,
      isRecurring: true,
      recurrenceConfig: original.recurrenceConfig as RecurrenceConfig,
    }).returning();

    if (originalSubtasks.length > 0) {
      await tx.insert(subtasks).values(
        originalSubtasks.map((s) => ({
          taskId: newTask.id,
          text: s.text,
          completed: false,
          order: s.order,
        }))
      );
    }

    await tx.insert(taskActivities).values({
      taskId: newTask.id,
      actorId,
      type: "task_duplicated",
      metadata: { originalTaskId: original.id, workspaceId: workspaceId ?? original.workspaceId ?? null },
    });
  });
}
