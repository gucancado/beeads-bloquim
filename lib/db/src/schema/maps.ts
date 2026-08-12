import { pgTable, text, timestamp, uuid, boolean, primaryKey, index, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * Tipo de mapa (Mapa Estratégico §6.1). `action` é o plano de ação atual
 * (default — preserva semântica). `strategy` é o canvas estratégico, no máximo
 * um por workspace (índice único parcial abaixo), criado lazy.
 */
export const mapKindEnum = pgEnum("map_kind", ["action", "strategy"]);

export const maps = pgTable("maps", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: mapKindEnum("kind").notNull().default("action"),
  hidden: boolean("hidden").notNull().default(false),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_maps_workspace").on(table.workspaceId),
  // No máximo 1 mapa strategy por workspace (§6.1).
  uniqueIndex("maps_one_strategy_per_ws")
    .on(table.workspaceId)
    .where(sql`${table.kind} = 'strategy'`),
]);

export const insertMapSchema = createInsertSchema(maps).omit({
  id: true,
  kind: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMap = z.infer<typeof insertMapSchema>;
export type Map = typeof maps.$inferSelect;

export const userMapAccess = pgTable(
  "user_map_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    lastAccessedAt: timestamp("last_accessed_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mapId] }),
    index("idx_user_map_access_user_recent").on(
      t.userId,
      t.lastAccessedAt.desc(),
    ),
  ],
);

export type UserMapAccess = typeof userMapAccess.$inferSelect;
