import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /**
   * Object storage path of the user's avatar inside the `avatars` bucket.
   * `null` means no avatar uploaded. Frontend never reads this directly —
   * it requests `/api/users/:id/avatar` which proxies the stream from storage.
   */
  avatarStoragePath: text("avatar_storage_path"),
  /**
   * Public URL for the avatar. Populated as `/api/users/:id/avatar` whenever
   * `avatar_storage_path` is non-null. Kept as a denormalised field so that
   * the many existing SELECT queries that read `users.avatarUrl` keep working
   * without per-row CASE expressions.
   */
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  passwordHash: true,
}).extend({
  password: z.string().min(8),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "passwordHash">;
