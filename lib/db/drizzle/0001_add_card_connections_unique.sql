ALTER TABLE "card_connections" ADD CONSTRAINT "card_connections_source_target_unique" UNIQUE("source_card_id","target_card_id");
