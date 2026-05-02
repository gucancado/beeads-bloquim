-- Task #193: User-defined task templates
-- Adds `task_templates` and `task_template_subtasks` to let each user save
-- and reuse a predefined task shape (name, title, description, priority,
-- subtasks). Templates are private to their owner and have no relational
-- link to tasks they're applied to.

CREATE TABLE IF NOT EXISTS "task_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text,
  "title" text,
  "description" text,
  "priority" "task_priority",
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_task_templates_user" ON "task_templates" ("user_id");

CREATE TABLE IF NOT EXISTS "task_template_subtasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "task_templates"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_task_template_subtasks_template_order"
  ON "task_template_subtasks" ("template_id", "order");
