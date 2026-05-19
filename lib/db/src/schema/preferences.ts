import { pgTable, text, uuid, integer, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userTaskColumnOrder = pgTable(
  "user_task_column_order",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    columnKey: text("column_key").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.columnKey] })],
);

export type UserTaskColumnOrder = typeof userTaskColumnOrder.$inferSelect;
