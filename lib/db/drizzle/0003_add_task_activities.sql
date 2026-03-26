DO $$ BEGIN
 CREATE TYPE "public"."task_activity_type" AS ENUM('task_created', 'assignee_changed', 'status_changed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" "task_activity_type" NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO task_activities (task_id, actor_id, type, metadata, created_at)
SELECT 
  t.id,
  NULL,
  'task_created',
  '{}',
  t.created_at
FROM tasks t
WHERE NOT EXISTS (
  SELECT 1 FROM task_activities ta 
  WHERE ta.task_id = t.id AND ta.type = 'task_created'
);
