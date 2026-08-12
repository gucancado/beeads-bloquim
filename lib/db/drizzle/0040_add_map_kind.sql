-- Mapa Estratégico §6.1 — coluna aditiva maps.kind + índice único parcial.
-- Default 'action' preserva a semântica dos mapas existentes (plano de ação).
-- No máximo 1 mapa 'strategy' por workspace.
--
-- Migration hand-written (o `drizzle-kit generate` deste repo está com os
-- snapshots meta/ defasados; o padrão do projeto é SQL manual + push, ver 0037).

CREATE TYPE map_kind AS ENUM ('action', 'strategy');

ALTER TABLE maps ADD COLUMN kind map_kind NOT NULL DEFAULT 'action';

CREATE UNIQUE INDEX maps_one_strategy_per_ws ON maps(workspace_id) WHERE kind = 'strategy';
