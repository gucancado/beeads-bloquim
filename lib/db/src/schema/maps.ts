import { pgTable, text, timestamp, uuid, boolean, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workspaces } from "./workspaces";
import { users } from "./users";

export const maps = pgTable("maps", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hidden: boolean("hidden").notNull().default(false),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMapSchema = createInsertSchema(maps).omit({
  id: true,
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
  (t) => [primaryKey({ columns: [t.userId, t.mapId] })],
);

export type UserMapAccess = typeof userMapAccess.$inferSelect;
