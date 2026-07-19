-- Mapa Estratégico §6.2–6.5 — camada de estratégia (aditiva).
-- Constraints cross-table (target_date ≤ cycle.ends_on; source/target edge no
-- mesmo map_id; strategy_nodes.workspace_id = maps.workspace_id; plano.action_map
-- kind='action') são validadas na CAMADA DE APLICAÇÃO (§2.2-step4), não em trigger.
-- Migration hand-written (generate do repo defasado, ver 0038).

CREATE TYPE strategy_cycle_status AS ENUM ('ativo', 'arquivado');
CREATE TYPE strategy_node_kind AS ENUM ('objetivo', 'swot', 'tema', 'kr', 'plano', 'recurso');
CREATE TYPE strategy_objective_status AS ENUM ('provisorio', 'validado', 'arquivado');
CREATE TYPE strategy_kr_direction AS ENUM ('subir', 'descer');
CREATE TYPE strategy_kr_health AS ENUM ('no_prazo', 'risco', 'fora', 'atingido', 'nao_atingido');
CREATE TYPE strategy_swot_type AS ENUM ('forca', 'fraqueza', 'oportunidade', 'ameaca');
CREATE TYPE strategy_resource_kind AS ENUM ('meta_ads', 'google_ads', 'site', 'instagram', 'outro');

CREATE TABLE strategy_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status strategy_cycle_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_strategy_cycles_map ON strategy_cycles(map_id);
CREATE UNIQUE INDEX strategy_cycles_one_active_per_map ON strategy_cycles(map_id) WHERE status = 'ativo';

CREATE TABLE strategy_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind strategy_node_kind NOT NULL,
  position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  width DOUBLE PRECISION,
  color TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_strategy_nodes_map ON strategy_nodes(map_id);
CREATE INDEX idx_strategy_nodes_workspace ON strategy_nodes(workspace_id);

CREATE TABLE strategy_objectives (
  node_id UUID PRIMARY KEY REFERENCES strategy_nodes(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL REFERENCES strategy_cycles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status strategy_objective_status NOT NULL DEFAULT 'provisorio'
);

CREATE TABLE strategy_krs (
  node_id UUID PRIMARY KEY REFERENCES strategy_nodes(id) ON DELETE CASCADE,
  cycle_id UUID NOT NULL REFERENCES strategy_cycles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  unit TEXT,
  target_value DOUBLE PRECISION NOT NULL,
  current_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  baseline_value DOUBLE PRECISION,
  direction strategy_kr_direction NOT NULL DEFAULT 'subir',
  target_date DATE,
  health_readings JSONB NOT NULL DEFAULT '[]'::jsonb,
  health strategy_kr_health
);

CREATE TABLE strategy_themes (
  node_id UUID PRIMARY KEY REFERENCES strategy_nodes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT
);

CREATE TABLE strategy_swot_cards (
  node_id UUID PRIMARY KEY REFERENCES strategy_nodes(id) ON DELETE CASCADE,
  swot_type strategy_swot_type NOT NULL,
  text TEXT NOT NULL DEFAULT ''
);

CREATE TABLE strategy_resources (
  node_id UUID PRIMARY KEY REFERENCES strategy_nodes(id) ON DELETE CASCADE,
  resource_kind strategy_resource_kind NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  binding JSONB
);

CREATE TABLE strategy_plans (
  node_id UUID PRIMARY KEY REFERENCES strategy_nodes(id) ON DELETE CASCADE,
  action_map_id UUID REFERENCES maps(id) ON DELETE SET NULL,
  hypothesis TEXT
);
CREATE UNIQUE INDEX strategy_plans_action_map_unique ON strategy_plans(action_map_id);

CREATE TABLE strategy_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES strategy_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES strategy_nodes(id) ON DELETE CASCADE,
  relation_type TEXT,
  label TEXT,
  metadata JSONB,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_strategy_edges_map ON strategy_edges(map_id);
CREATE INDEX idx_strategy_edges_source ON strategy_edges(source_node_id);
CREATE INDEX idx_strategy_edges_target ON strategy_edges(target_node_id);
