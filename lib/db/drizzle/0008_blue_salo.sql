CREATE TABLE "map_text_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"content" text DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}' NOT NULL,
	"position_x" double precision DEFAULT 0 NOT NULL,
	"position_y" double precision DEFAULT 0 NOT NULL,
	"width" double precision DEFAULT 200 NOT NULL,
	"height" double precision DEFAULT 80 NOT NULL,
	"font_size" integer DEFAULT 14 NOT NULL,
	"color" text DEFAULT '#374151' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "map_text_elements" ADD CONSTRAINT "map_text_elements_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;
