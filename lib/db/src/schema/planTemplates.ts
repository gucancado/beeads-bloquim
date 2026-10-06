import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Modelo de plano de ação (spec 2026-10-05-modelos-de-plano). Privado por
 * usuário, como task_templates. `payload` é um snapshot versionado
 * (`v: 1`) validado com Zod na aplicação — ver
 * artifacts/api-server/src/services/planTemplates/types.ts.
 */
export const planTemplates = pgTable("plan_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_plan_templates_user").on(table.userId),
]);

export type PlanTemplate = typeof planTemplates.$inferSelect;
