import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const workspaceAgents = pgTable(
  "workspace_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentName: text("agent_name").notNull(),
    projectSlug: text("project_slug").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_agents_unique_idx").on(
      table.workspaceId,
      table.agentName,
      table.projectSlug,
    ),
    index("idx_workspace_agents_workspace_id").on(table.workspaceId),
    index("idx_workspace_agents_agent_project").on(table.agentName, table.projectSlug),
  ],
);

export type WorkspaceAgent = typeof workspaceAgents.$inferSelect;
export type NewWorkspaceAgent = typeof workspaceAgents.$inferInsert;
