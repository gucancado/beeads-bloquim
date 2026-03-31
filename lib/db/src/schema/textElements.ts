import {
  pgTable,
  text,
  timestamp,
  uuid,
  doublePrecision,
  integer,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { maps } from "./maps";

export const mapTextElements = pgTable("map_text_elements", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  content: text("content").notNull().default('{"type":"doc","content":[{"type":"paragraph"}]}'),
  positionX: doublePrecision("position_x").notNull().default(0),
  positionY: doublePrecision("position_y").notNull().default(0),
  width: doublePrecision("width").notNull().default(200),
  height: doublePrecision("height").notNull().default(80),
  fontSize: integer("font_size").notNull().default(14),
  color: text("color").notNull().default("#374151"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMapTextElementSchema = z.object({
  positionX: z.number().optional().default(0),
  positionY: z.number().optional().default(0),
  width: z.number().optional().default(200),
  height: z.number().optional().default(80),
  fontSize: z.number().int().optional().default(14),
  color: z.string().optional().default("#374151"),
  content: z.string().optional().default('{"type":"doc","content":[{"type":"paragraph"}]}'),
});

export const updateMapTextElementSchema = z.object({
  content: z.string().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  fontSize: z.number().int().optional(),
  color: z.string().optional(),
});

export type MapTextElement = typeof mapTextElements.$inferSelect;
