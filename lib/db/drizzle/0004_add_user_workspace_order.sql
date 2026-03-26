CREATE TABLE IF NOT EXISTS "user_workspace_order" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "user_workspace_order_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_workspace_order" ADD CONSTRAINT "user_workspace_order_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_workspace_order" ADD CONSTRAINT "user_workspace_order_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
