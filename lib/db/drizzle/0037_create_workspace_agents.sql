CREATE TABLE workspace_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  project_slug TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, agent_name, project_slug)
);

CREATE INDEX idx_workspace_agents_workspace_id ON workspace_agents(workspace_id);
CREATE INDEX idx_workspace_agents_agent_project ON workspace_agents(agent_name, project_slug);
