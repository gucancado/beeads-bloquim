import { pgTable, text, timestamp, uuid, pgEnum, boolean, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

export const workspaceRoleEnum = pgEnum("workspace_role", [
  "admin",
  "editor",
  "executor",
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  hidden: boolean("hidden").notNull().default(false),
  colorIndex: integer("color_index"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("executor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_workspace_members_workspace_user").on(
      table.workspaceId,
      table.userId,
    ),
    index("idx_workspace_members_user").on(table.userId),
  ],
);

export const userWorkspaceOrder = pgTable(
  "user_workspace_order",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    expanded: boolean("expanded").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })],
);

export type UserWorkspaceOrder = typeof userWorkspaceOrder.$inferSelect;

export const insertWorkspaceSchema = createInsertSchema(workspaces).omit({
  id: true,
  createdBy: true,
  createdAt: true,
});

export const insertWorkspaceMemberSchema = createInsertSchema(
  workspaceMembers
).omit({ id: true, createdAt: true });

export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
