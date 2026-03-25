import {
  pgTable,
  text,
  timestamp,
  uuid,
  doublePrecision,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { maps } from "./maps";
import { tasks } from "./tasks";

export const cardVisualStatusEnum = pgEnum("card_visual_status", [
  "no_task",
  "pending",
  "in_progress",
  "completed",
  "overdue",
  "blocked",
]);

export const cards = pgTable("cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  positionX: doublePrecision("position_x").notNull().default(0),
  positionY: doublePrecision("position_y").notNull().default(0),
  statusVisual: cardVisualStatusEnum("status_visual")
    .notNull()
    .default("no_task"),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const cardConnections = pgTable("card_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  sourceCardId: uuid("source_card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  targetCardId: uuid("target_card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  sourceHandle: text("source_handle"),
  targetHandle: text("target_handle"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueConnection: unique("card_connections_source_target_unique").on(table.sourceCardId, table.targetCardId),
}));

export const insertCardSchema = createInsertSchema(cards).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  statusVisual: true,
  taskId: true,
});

export const updateCardSchema = createInsertSchema(cards)
  .omit({ id: true, mapId: true, createdAt: true, updatedAt: true })
  .partial();

export const insertCardConnectionSchema = createInsertSchema(
  cardConnections
).omit({ id: true, createdAt: true });

export type InsertCard = z.infer<typeof insertCardSchema>;
export type UpdateCard = z.infer<typeof updateCardSchema>;
export type Card = typeof cards.$inferSelect;
export type CardConnection = typeof cardConnections.$inferSelect;
