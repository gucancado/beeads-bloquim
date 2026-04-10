import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const fileUploads = pgTable("file_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const attachmentLinks = pgTable("attachment_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileUploadId: uuid("file_upload_id").notNull().references(() => fileUploads.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FileUpload = typeof fileUploads.$inferSelect;
export type AttachmentLink = typeof attachmentLinks.$inferSelect;
