ALTER TABLE "map_shapes" ADD COLUMN "rotation" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "map_shapes" ADD COLUMN "x1" double precision;--> statement-breakpoint
ALTER TABLE "map_shapes" ADD COLUMN "y1" double precision;--> statement-breakpoint
ALTER TABLE "map_shapes" ADD COLUMN "x2" double precision;--> statement-breakpoint
ALTER TABLE "map_shapes" ADD COLUMN "y2" double precision;--> statement-breakpoint
UPDATE "map_shapes" SET "x1" = 0, "y1" = 0, "x2" = "width", "y2" = 0 WHERE "type" = 'line' AND "x1" IS NULL;