import { pgTable, uuid, text, doublePrecision, date, jsonb, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { strategyNodes } from "./strategyNodes";
import { strategyCycles } from "./strategyCycles";
import { maps } from "./maps";

/**
 * Mapa Estratégico §6.4 — satélites tipados 1:1 por node_id. Cada nó de
 * strategy_nodes tem exatamente um satélite, da tabela que casa com seu kind
 * (garantido na criação transacional, §6.6/§10.3). node_id é PK e FK cascade.
 */

// ---- Objetivo ----
export const objectiveStatusEnum = pgEnum("strategy_objective_status", [
  "provisorio",
  "validado",
  "arquivado",
]);

export const strategyObjectives = pgTable("strategy_objectives", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => strategyNodes.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => strategyCycles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: objectiveStatusEnum("status").notNull().default("provisorio"),
});
export type StrategyObjective = typeof strategyObjectives.$inferSelect;

// ---- KR ----
export const krDirectionEnum = pgEnum("strategy_kr_direction", ["subir", "descer"]);
export const krHealthEnum = pgEnum("strategy_kr_health", [
  "no_prazo",
  "risco",
  "fora",
  "atingido",
  "nao_atingido",
]);

/** Snapshot de saúde empurrado em cada PATCH de current_value (§8.1 suavização). */
export type HealthReading = { health: string; ratio: number | null; at: string };

export const strategyKrs = pgTable("strategy_krs", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => strategyNodes.id, { onDelete: "cascade" }),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => strategyCycles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  unit: text("unit"),
  targetValue: doublePrecision("target_value").notNull(),
  currentValue: doublePrecision("current_value").notNull().default(0),
  baselineValue: doublePrecision("baseline_value"),
  direction: krDirectionEnum("direction").notNull().default("subir"),
  // Nasce puxando cycle.ends_on; CHECK target_date ≤ cycle.ends_on é validado
  // na app (cross-table, §6.4/§2.2-step4).
  targetDate: date("target_date"),
  // Array circular dos últimos N snapshots de saúde (base da suavização §8.1).
  healthReadings: jsonb("health_readings").$type<HealthReading[]>().notNull().default([]),
  // Saúde suavizada, atualizada no PATCH de current_value (§8). NÃO source_*.
  health: krHealthEnum("health"),
});
export type StrategyKr = typeof strategyKrs.$inferSelect;

// ---- Tema ----
export const strategyThemes = pgTable("strategy_themes", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => strategyNodes.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
});
export type StrategyTheme = typeof strategyThemes.$inferSelect;

// ---- SWOT ----
export const swotTypeEnum = pgEnum("strategy_swot_type", [
  "forca",
  "fraqueza",
  "oportunidade",
  "ameaca",
]);

export const strategySwotCards = pgTable("strategy_swot_cards", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => strategyNodes.id, { onDelete: "cascade" }),
  swotType: swotTypeEnum("swot_type").notNull(),
  text: text("text").notNull().default(""),
});
export type StrategySwotCard = typeof strategySwotCards.$inferSelect;

// ---- Recurso ----
export const resourceKindEnum = pgEnum("strategy_resource_kind", [
  "meta_ads",
  "google_ads",
  "site",
  "instagram",
  "outro",
]);

export const strategyResources = pgTable("strategy_resources", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => strategyNodes.id, { onDelete: "cascade" }),
  resourceKind: resourceKindEnum("resource_kind").notNull(),
  label: text("label").notNull().default(""),
  // Preenchido/editável no v1, consumido no pull v2 (§6.4/§8.2).
  binding: jsonb("binding"),
});
export type StrategyResource = typeof strategyResources.$inferSelect;

// ---- Plano ----
export const strategyPlans = pgTable("strategy_plans", {
  nodeId: uuid("node_id")
    .primaryKey()
    .references(() => strategyNodes.id, { onDelete: "cascade" }),
  // O map operacional (kind='action'). Apagar o map zera o vínculo (preserva o
  // nó). CHECK de que kind='action' é validado na app (cross-table). 1:1 (gap #7).
  actionMapId: uuid("action_map_id").references(() => maps.id, { onDelete: "set null" }),
  hypothesis: text("hypothesis"),
}, (t) => [
  uniqueIndex("strategy_plans_action_map_unique").on(t.actionMapId),
]);
export type StrategyPlan = typeof strategyPlans.$inferSelect;
