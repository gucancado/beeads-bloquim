import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  boolean,
  integer,
  jsonb,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";
import { maps } from "./maps";
import { workspaces } from "./workspaces";

export type RecurrenceType = "daily" | "weekly" | "monthly" | "yearly" | "periodic" | "custom";

export interface RecurrenceConfig {
  type: RecurrenceType;
  weekDays?: number[];
  monthlyMode?: "ordinal" | "day";
  ordinalWeek?: number;
  ordinalDay?: number;
  monthDay?: number;
  intervalDays?: number;
  customInterval?: number;
  customUnit?: "day" | "week" | "month" | "year";
  customWeekDays?: number[];
}

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in_progress",
  "completed",
  "overdue",
  "blocked",
  "draft",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const approvalModeEnum = pgEnum("approval_mode", [
  "sequential",
  "parallel",
]);

export const parentApprovalStatusEnum = pgEnum("parent_approval_status", [
  "in_approval",
  "approved",
  "rejected",
]);

export const scheduleModeEnum = pgEnum("schedule_mode", [
  "ate",
  "entre",
  "em",
  "sem_prazo",
  "urgente",
]);

export type ScheduleMode = "ate" | "entre" | "em" | "sem_prazo" | "urgente";

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .references(() => maps.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  assignedTo: uuid("assigned_to").references(() => users.id, {
    onDelete: "set null",
  }),
  dueDate: timestamp("due_date"),
  startAt: timestamp("start_at"),
  scheduleMode: scheduleModeEnum("schedule_mode").notNull().default("sem_prazo"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  status: taskStatusEnum("status").notNull().default("pending"),
  previousStatus: taskStatusEnum("previous_status"),
  overdue: boolean("overdue").notNull().default(false),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  isApprovalTask: boolean("is_approval_task").notNull().default(false),
  parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
  approvalOrder: integer("approval_order"),
  approvalStatus: approvalStatusEnum("approval_status"),
  approvalComment: text("approval_comment"),
  approvalMode: approvalModeEnum("approval_mode"),
  parentApprovalStatus: parentApprovalStatusEnum("parent_approval_status"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceConfig: jsonb("recurrence_config").$type<RecurrenceConfig>(),
  /**
   * User who created the task. Nullable for two reasons:
   * - rows that pre-date this column (backfill leaves NULL where the
   *   `task_created` activity is missing);
   * - the FK uses `set null` so deleting a user preserves the task.
   *
   * Used to enforce "only the creator can delete" — see DELETE routes in
   * myTasks.ts / workspaceTasks.ts. NULL rows refuse delete via API (must go
   * through UI as workspace admin).
   */
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_tasks_workspace_status_due").on(
    table.workspaceId,
    table.status,
    table.dueDate,
  ),
  index("idx_tasks_assigned_to").on(table.assignedTo),
  index("idx_tasks_parent")
    .on(table.parentTaskId)
    .where(sql`${table.parentTaskId} IS NOT NULL`),
  index("idx_tasks_overdue_scan")
    .on(table.dueDate)
    .where(
      sql`${table.status} NOT IN ('completed','draft') AND ${table.overdue} = false`,
    ),
  index("idx_tasks_map")
    .on(table.mapId)
    .where(sql`${table.mapId} IS NOT NULL`),
]);

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  cancelledAt: true,
});

export const updateTaskSchema = insertTaskSchema.partial().omit({
  mapId: true,
  workspaceId: true,
});

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;
export type Task = typeof tasks.$inferSelect;

export const subtasks = pgTable("subtasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  completed: boolean("completed").notNull().default(false),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_subtasks_task_order").on(table.taskId, table.order),
]);

export const insertSubtaskSchema = createInsertSchema(subtasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSubtask = z.infer<typeof insertSubtaskSchema>;
export type Subtask = typeof subtasks.$inferSelect;

export const taskActivityTypeEnum = pgEnum("task_activity_type", [
  "task_created",
  "assignee_changed",
  "status_changed",
  "priority_changed",
  "due_date_changed",
  "approval_comment",
  "task_approved",
  "task_rejected",
  "task_duplicated",
  // Emitted when ≥1 checklist item is added via POST /:taskId/subtasks (workspace
  // or standalone). Always batched: one row per request, metadata.itemCount
  // carries how many items the call added. See add_checklist_items in the MCP.
  "checklist_items_added",
  // Emitted when a standalone task is moved into a workspace via
  // POST /my-tasks/:taskId/move-to-workspace. metadata.toWorkspaceId is set;
  // fromWorkspaceId is implicitly null (only standalone → workspace is supported).
  "task_moved",
  // Task linking + attachment inheritance (spec:
  // docs/specs/task-linking-and-attachment-inheritance.md). Recorded on BOTH
  // ends of a link (source and target) for symmetric audit.
  "task_link_created",
  "task_link_removed",
  // Attachment kind changed on a per-task link (task_attachments.kind).
  // metadata: { attachmentId, filename, propagatedToCount?, removedFromCount? }
  "attachment_promoted",
  "attachment_demoted",
  // Attachment unlinked from a task without deleting the underlying file.
  // metadata: { attachmentId, filename }
  "attachment_unlinked",
  // Attachment added to / removed from a task. metadata: { attachmentId, filename }
  "attachment_added",
  "attachment_removed",
]);

export const taskActivities = pgTable("task_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  type: taskActivityTypeEnum("type").notNull(),
  metadata: jsonb("metadata").$type<Record<string, string | null>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("idx_task_activities_task_created").on(table.taskId, table.createdAt),
]);

export type TaskActivity = typeof taskActivities.$inferSelect;

export const taskTemplates = pgTable("task_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  title: text("title"),
  description: text("description"),
  priority: taskPriorityEnum("priority"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_task_templates_user").on(table.userId),
]);

export type TaskTemplate = typeof taskTemplates.$inferSelect;

export const taskTemplateSubtasks = pgTable("task_template_subtasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => taskTemplates.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_task_template_subtasks_template_order").on(table.templateId, table.order),
]);

export type TaskTemplateSubtask = typeof taskTemplateSubtasks.$inferSelect;
