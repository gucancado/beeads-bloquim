import { pgTable, text, timestamp, uuid, pgEnum, integer, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { maps } from "./maps";
import { workspaces } from "./workspaces";

export const meetingStatusEnum = pgEnum("meeting_status", [
  "collecting",
  "transcribed",
  "failed",
  "canceled",
]);

export type MeetingParticipant = { name: string; segments: number };

export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  mapId: uuid("map_id").references(() => maps.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  title: text("title"),
  meetCode: text("meet_code").notNull(),
  meetUrl: text("meet_url"),
  status: meetingStatusEnum("status").notNull().default("collecting"),
  failureReason: text("failure_reason"),
  workerMeetingId: text("worker_meeting_id"),
  episodeId: integer("episode_id"),
  participants: jsonb("participants").$type<MeetingParticipant[]>(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_meetings_workspace").on(table.workspaceId),
  index("idx_meetings_created_by").on(table.createdBy),
]);

export type Meeting = typeof meetings.$inferSelect;
