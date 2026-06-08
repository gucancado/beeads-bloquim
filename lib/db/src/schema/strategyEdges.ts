import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { maps } from "./maps";
import { strategyNodes } from "./strategyNodes";
import { users } from "./users";

/**
 * Mapa Estratégico §6.5 — arestas do grafo estratégico. Grafo livre (qualquer
 * kind liga em qualquer kind). `relation_type` é pré-preenchido pela gramática
 * na criação (KR→Objetivo=mede, Plano→KR=move, Tema→Objetivo=serve,
 * Tema→Plano=contem), editável/apagável; vocabulário gera·serve·contem·move·mede.
 * Constraint "ambos os nós no mesmo map_id" validada na app (§6.5/§2.2-step4).
 */
export const strategyEdges = pgTable("strategy_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  sourceNodeId: uuid("source_node_id")
    .notNull()
    .references(() => strategyNodes.id, { onDelete: "cascade" }),
  targetNodeId: uuid("target_node_id")
    .notNull()
    .references(() => strategyNodes.id, { onDelete: "cascade" }),
  relationType: text("relation_type"),
  label: text("label"),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_strategy_edges_map").on(t.mapId),
  index("idx_strategy_edges_source").on(t.sourceNodeId),
  index("idx_strategy_edges_target").on(t.targetNodeId),
]);

export type StrategyEdge = typeof strategyEdges.$inferSelect;
