-- Per-user ordering of task table columns. Each row pins one columnKey to a
-- position in the user's saved column layout for the task list. PK is
-- composite (user_id, column_key). Mirrors the pattern of user_workspace_order.

CREATE TABLE IF NOT EXISTS "user_task_column_order" (
  "user_id" uuid NOT NULL,
  "column_key" text NOT NULL,
  "sort_order" integer NOT NULL,
  CONSTRAINT "user_task_column_order_user_id_column_key_pk" PRIMARY KEY("user_id","column_key")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_task_column_order" ADD CONSTRAINT "user_task_column_order_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
