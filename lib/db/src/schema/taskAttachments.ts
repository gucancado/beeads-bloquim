import {
  pgTable,
  timestamp,
  uuid,
  pgEnum,
  primaryKey,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { tasks } from "./tasks";
import { attachments } from "./attachments";

/**
 * Per-task attachment kind. Lives on the JOIN row, not on the attachment, so the
 * same file can be a deliverable in task A and a standard attachment in task B.
 */
export const taskAttachmentKindEnum = pgEnum("task_attachment_kind", [
  "standard",
  "deliverable",
]);

export type TaskAttachmentKind = "standard" | "deliverable";

/**
 * Join table between tasks and attachments. Replaces the legacy direct FK
 * `attachments.task_id` (still present during the 2-phase migration; the legacy
 * column is dropped in a follow-up migration once all services read from here).
 *
 * - `kind` is per-link: same attachment row can be deliverable in A, standard in B.
 * - `inherited_from_task_id` is non-null when this row was auto-created by the
 *   inheritance cascade (POST /links or attachment promotion). NULL when the
 *   attachment was uploaded directly into this task. Used to scope the
 *   downstream removal cascade in §5.4 of the spec.
 */
export const taskAttachments = pgTable(
  "task_attachments",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    kind: taskAttachmentKindEnum("kind").notNull().default("standard"),
    inheritedFromTaskId: uuid("inherited_from_task_id").references(
      (): AnyPgColumn => tasks.id,
      { onDelete: "set null" },
    ),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.attachmentId] }),
    index("idx_task_attachments_task").on(table.taskId),
    index("idx_task_attachments_attachment").on(table.attachmentId),
    index("idx_task_attachments_deliverables")
      .on(table.taskId)
      .where(sql`${table.kind} = 'deliverable'`),
    index("idx_task_attachments_inherited_from")
      .on(table.inheritedFromTaskId)
      .where(sql`${table.inheritedFromTaskId} IS NOT NULL`),
  ],
);

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type InsertTaskAttachment = typeof taskAttachments.$inferInsert;
