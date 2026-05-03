import { pgTable, text, timestamp, uuid, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userGoogleCalendarAccounts = pgTable(
  "user_google_calendar_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleAccountEmail: text("google_account_email").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idx_gcal_account_user").on(t.userId)],
);

export const userCalendarPreferences = pgTable(
  "user_calendar_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    calendarName: text("calendar_name").notNull(),
    calendarColor: text("calendar_color"),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idx_calpref_user_calendar").on(t.userId, t.googleCalendarId)],
);

export type UserGoogleCalendarAccount = typeof userGoogleCalendarAccounts.$inferSelect;
export type UserCalendarPreference = typeof userCalendarPreferences.$inferSelect;
