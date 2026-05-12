-- Add user profile fields: whatsapp, classes (multi-select catalog), pronouns.
-- The classes column is a free-form text[] so the catalog can be extended without a migration.

CREATE TYPE "user_pronouns" AS ENUM ('name_only', 'ela_dela', 'ele_dele', 'elu_delu');

ALTER TABLE "users" ADD COLUMN "whatsapp" text;
ALTER TABLE "users" ADD COLUMN "classes" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "users" ADD COLUMN "pronouns" "user_pronouns" DEFAULT 'name_only' NOT NULL;
