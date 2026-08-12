import { pgTable, uuid, text, doublePrecision, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { maps } from "./maps";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * Mapa Estratégico §6.3 — o nó do canvas estratégico. A semântica vive nos
 * satélites tipados 1:1 (strategyEntities). `workspace_id` é denormalizado para
 * auth e DEVE casar com maps.workspace_id do map_id (validado na app, §6.6).
 */
export const strategyNodeKindEnum = pgEnum("strategy_node_kind", [
  "objetivo",
  "swot",
  "tema",
  "kr",
  "plano",
  "recurso",
]);

export const strategyNodes = pgTable("strategy_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: strategyNodeKindEnum("kind").notNull(),
  positionX: doublePrecision("position_x").notNull().default(0),
  positionY: doublePrecision("position_y").notNull().default(0),
  width: doublePrecision("width"),
  color: text("color"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_strategy_nodes_map").on(t.mapId),
  index("idx_strategy_nodes_workspace").on(t.workspaceId),
]);

export type StrategyNode = typeof strategyNodes.$inferSelect;
