import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { workspaces } from "./workspaces";
import { cards } from "./cards";
import { maps } from "./maps";
import { taskComments } from "./comments";

/**
 * Unified attachments table. The actual file lives in object storage
 * (S3-compatible: Cloudflare R2 in prod). The DB only stores metadata +
 * the storage path needed to fetch it.
 *
 * Per-entity anchoring:
 *  - tasks → `task_attachments` (join table with per-link kind +
 *    inherited_from_task_id for canvas-driven inheritance).
 *  - cards / comments / maps / plans → columns on this table.
 *
 * The legacy `task_id` and `kind` columns were dropped in migration 0036;
 * the trigger that synced them to `task_attachments` was dropped at the
 * same time.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").references(() => taskComments.id, {
      onDelete: "cascade",
    }),
    mapId: uuid("map_id").references(() => maps.id, { onDelete: "cascade" }),
    // No FK yet — `plans` table doesn't exist in the schema. Treated as a
    // free-form correlation id; will be tied to a real table in a future migration.
    planId: uuid("plan_id"),

    /** Logical bucket name — "attachments" | "avatars" | "public-assets" */
    bucket: text("bucket").notNull(),
    /** Object key inside the bucket */
    storagePath: text("storage_path").notNull(),

    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),

    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Soft delete — file may still exist in storage until a GC job purges it. */
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("idx_attachments_workspace_created").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("idx_attachments_card")
      .on(table.cardId, table.createdAt)
      .where(sql`${table.cardId} IS NOT NULL`),
    index("idx_attachments_comment")
      .on(table.commentId, table.createdAt)
      .where(sql`${table.commentId} IS NOT NULL`),
    index("idx_attachments_map")
      .on(table.mapId, table.createdAt)
      .where(sql`${table.mapId} IS NOT NULL`),
    index("idx_attachments_alive")
      .on(table.workspaceId)
      .where(sql`${table.deletedAt} IS NULL`),
    // No CHECK constraint enforcing an anchor: task anchoring lives in
    // task_attachments (separate table), which CHECK can't reference. The
    // application layer is responsible for ensuring every attachment is
    // anchored somewhere; orphan rows get cleaned by the GC job.
  ],
);

export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;
