import { pgTable, uuid, text, date, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { maps } from "./maps";

/**
 * Mapa Estratégico §6.2 — período de planejamento no nível do mapa (não por
 * objetivo). A cadência OKR (fechar → arquivar → reabrir) age sobre o ciclo;
 * objetivos e KRs compartilham o cycle_id. No máximo 1 ciclo `ativo` por mapa.
 */
export const cycleStatusEnum = pgEnum("strategy_cycle_status", ["ativo", "arquivado"]);

export const strategyCycles = pgTable("strategy_cycles", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  status: cycleStatusEnum("status").notNull().default("ativo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_strategy_cycles_map").on(t.mapId),
  // No máximo 1 ciclo ativo por mapa (§6.2).
  uniqueIndex("strategy_cycles_one_active_per_map")
    .on(t.mapId)
    .where(sql`${t.status} = 'ativo'`),
]);

export type StrategyCycle = typeof strategyCycles.$inferSelect;
