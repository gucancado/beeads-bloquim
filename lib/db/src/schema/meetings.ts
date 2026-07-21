import { pgTable, text, timestamp, uuid, pgEnum, integer, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";
import { maps } from "./maps";
import { workspaces } from "./workspaces";
import { userGoogleCalendarAccounts } from "./integrations";

export const meetingStatusEnum = pgEnum("meeting_status", [
  "collecting",
  "transcribed",
  "failed",
  "canceled",
  "scheduled",
  "needs_triage",
  "missed",
]);

export type MeetingParticipant = { name: string; segments: number };

export type MeetingAttendee = { email: string; displayName?: string };

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
  gcalIcalUid: text("gcal_ical_uid"),
  gcalEventId: text("gcal_event_id"),
  gcalCalendarId: text("gcal_calendar_id"),
  sourceAccountId: uuid("source_account_id").references(() => userGoogleCalendarAccounts.id, { onDelete: "set null" }),
  gcalRecurringEventId: text("gcal_recurring_event_id"),
  gcalOriginalStartAt: timestamp("gcal_original_start_at"),
  scheduledStartAt: timestamp("scheduled_start_at"),
  scheduledEndAt: timestamp("scheduled_end_at"),
  attendees: jsonb("attendees").$type<MeetingAttendee[]>(),
  collectEnabled: boolean("collect_enabled").notNull().default(true),
  attributionMethod: text("attribution_method"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_meetings_workspace").on(table.workspaceId),
  index("idx_meetings_created_by").on(table.createdBy),
  uniqueIndex("uq_meetings_gcal_occurrence").on(table.gcalIcalUid, table.gcalOriginalStartAt),
]);

export type Meeting = typeof meetings.$inferSelect;
