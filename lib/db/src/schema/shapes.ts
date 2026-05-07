import {
  pgTable,
  text,
  timestamp,
  uuid,
  doublePrecision,
  boolean,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { maps } from "./maps";
import { attachments } from "./attachments";

export const mapShapes = pgTable("map_shapes", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("rect"),
  positionX: doublePrecision("position_x").notNull().default(0),
  positionY: doublePrecision("position_y").notNull().default(0),
  width: doublePrecision("width").notNull().default(200),
  height: doublePrecision("height").notNull().default(120),
  rotation: doublePrecision("rotation").notNull().default(0),
  color: text("color").notNull().default("#6366f1"),
  filled: boolean("filled").notNull().default(false),
  strokeStyle: text("stroke_style").notNull().default("solid"),
  x1: doublePrecision("x1"),
  y1: doublePrecision("y1"),
  x2: doublePrecision("x2"),
  y2: doublePrecision("y2"),
  /** Image shapes reference an attachments row in the `attachments` bucket. */
  attachmentId: uuid("attachment_id").references(() => attachments.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertMapShapeSchema = z
  .object({
    type: z.enum(["line", "rect", "ellipse", "image"]).optional().default("rect"),
    positionX: z.number().optional().default(0),
    positionY: z.number().optional().default(0),
    width: z.number().optional().default(200),
    height: z.number().optional().default(120),
    rotation: z.number().optional().default(0),
    color: z.string().optional().default("#6366f1"),
    filled: z.boolean().optional().default(false),
    strokeStyle: z.enum(["solid", "dashed"]).optional().default("solid"),
    x1: z.number().nullable().optional(),
    y1: z.number().nullable().optional(),
    x2: z.number().nullable().optional(),
    y2: z.number().nullable().optional(),
    attachmentId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => d.type !== "image" || !!d.attachmentId, {
    message: "attachmentId is required when type is image",
    path: ["attachmentId"],
  });

export const updateMapShapeSchema = z.object({
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  color: z.string().optional(),
  filled: z.boolean().optional(),
  strokeStyle: z.enum(["solid", "dashed"]).optional(),
  x1: z.number().nullable().optional(),
  y1: z.number().nullable().optional(),
  x2: z.number().nullable().optional(),
  y2: z.number().nullable().optional(),
});

export type MapShape = typeof mapShapes.$inferSelect;
