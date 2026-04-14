CREATE TABLE "map_shapes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"type" text DEFAULT 'rect' NOT NULL,
	"position_x" double precision DEFAULT 0 NOT NULL,
	"position_y" double precision DEFAULT 0 NOT NULL,
	"width" double precision DEFAULT 200 NOT NULL,
	"height" double precision DEFAULT 120 NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"filled" boolean DEFAULT false NOT NULL,
	"stroke_style" text DEFAULT 'solid' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "map_shapes" ADD CONSTRAINT "map_shapes_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;