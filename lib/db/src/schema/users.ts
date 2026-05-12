import { pgTable, text, timestamp, uuid, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userPronounsEnum = pgEnum("user_pronouns", [
  "name_only",
  "ela_dela",
  "ele_dele",
  "elu_delu",
]);

export const USER_CLASS_VALUES = [
  "gerente_contas",
  "gestor_trafego",
  "gestor_midias_sociais",
  "analista_dados",
  "designer",
  "tecnico",
] as const;

export type UserClass = (typeof USER_CLASS_VALUES)[number];

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
  whatsapp: text("whatsapp"),
  // Free-form text array so the catalog can be extended without a migration.
  classes: text("classes").array().notNull().default([]).$type<UserClass[]>(),
  pronouns: userPronounsEnum("pronouns").notNull().default("name_only"),
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
