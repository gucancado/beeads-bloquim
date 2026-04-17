CREATE UNIQUE INDEX "idx_workspace_members_workspace_user" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_members_user" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_maps_workspace" ON "maps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_user_map_access_user_recent" ON "user_map_access" USING btree ("user_id","last_accessed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_subtasks_task_order" ON "subtasks" USING btree ("task_id","order");--> statement-breakpoint
CREATE INDEX "idx_task_activities_task_created" ON "task_activities" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_workspace_status_due" ON "tasks" USING btree ("workspace_id","status","due_date");--> statement-breakpoint
CREATE INDEX "idx_tasks_assigned_to" ON "tasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_tasks_parent" ON "tasks" USING btree ("parent_task_id") WHERE "tasks"."parent_task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tasks_overdue_scan" ON "tasks" USING btree ("due_date") WHERE "tasks"."status" NOT IN ('completed','draft') AND "tasks"."overdue" = false;--> statement-breakpoint
CREATE INDEX "idx_tasks_map" ON "tasks" USING btree ("map_id") WHERE "tasks"."map_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_card_connections_map" ON "card_connections" USING btree ("map_id");--> statement-breakpoint
CREATE INDEX "idx_card_connections_target" ON "card_connections" USING btree ("target_card_id");--> statement-breakpoint
CREATE INDEX "idx_cards_map" ON "cards" USING btree ("map_id");--> statement-breakpoint
CREATE INDEX "idx_cards_task" ON "cards" USING btree ("task_id") WHERE "cards"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_task_comments_task_created" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_attachment_links_entity" ON "attachment_links" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_attachment_links_file_upload" ON "attachment_links" USING btree ("file_upload_id");