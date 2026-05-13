import { db } from "@workspace/db";
import { taskActivities } from "@workspace/db/schema";

type Metadata = Record<string, string | null>;
type ActivityType = typeof taskActivities.$inferInsert["type"];

export async function recordTaskActivity(args: {
  taskId: string;
  actorId: string | null;
  type: ActivityType;
  metadata?: Metadata;
  source?: string | null;
}): Promise<void> {
  const metadata: Metadata = { ...(args.metadata ?? {}) };
  if (args.source) metadata.source = args.source;
  await db.insert(taskActivities).values({
    taskId: args.taskId,
    actorId: args.actorId,
    type: args.type,
    metadata,
  });
}
