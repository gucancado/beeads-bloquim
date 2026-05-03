ALTER TABLE "map_shapes" ADD COLUMN IF NOT EXISTS "file_upload_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "map_shapes" ADD CONSTRAINT "map_shapes_file_upload_id_file_uploads_id_fk" FOREIGN KEY ("file_upload_id") REFERENCES "public"."file_uploads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
