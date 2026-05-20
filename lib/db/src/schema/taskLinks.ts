import {
  pgTable,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { workspaces } from "./workspaces";
import { maps } from "./maps";
import { tasks } from "./tasks";

/**
 * Directed link between two tasks inside the same plan (map). A→B means
 * "A delivers to B": deliverable-kind attachments on A surface as standard
 * attachments on B. See docs/specs/task-linking-and-attachment-inheritance.md.
 *
 * Scope invariants enforced by the service (not by DB):
 *   - tasks.map_id IS NOT NULL for both source and target
 *   - tasks.map_id matches plan_id for both endpoints
 * Approval subtasks always have map_id IS NULL, so they're excluded for free.
 */
export const taskLinks = pgTable(
  "task_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Plan (map) both tasks belong to. Hard FK; deleting the plan removes links. */
    planId: uuid("plan_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    sourceTaskId: uuid("source_task_id")
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    targetTaskId: uuid("target_task_id")
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_task_links_source_target").on(
      table.sourceTaskId,
      table.targetTaskId,
    ),
    check(
      "task_links_no_self_loop",
      sql`${table.sourceTaskId} <> ${table.targetTaskId}`,
    ),
    index("idx_task_links_source").on(table.sourceTaskId),
    index("idx_task_links_target").on(table.targetTaskId),
    index("idx_task_links_plan").on(table.planId),
  ],
);

export type TaskLink = typeof taskLinks.$inferSelect;
export type InsertTaskLink = typeof taskLinks.$inferInsert;
