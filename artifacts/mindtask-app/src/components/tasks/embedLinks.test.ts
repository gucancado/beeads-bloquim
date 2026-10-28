import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Varredura estática: dentro das telas que também rodam sob `/embed/*`, todo
 * link ou navegação para rota de workspace monta o prefixo por
 * `workspaceRouteBase` — um literal `/workspaces/...` tiraria o iframe do
 * embed (e cairia no AppLayout com sidebar dentro do painel).
 */
const FILES = [
  "components/tasks/TaskListItem.tsx",
  "components/tasks/ApprovalTaskView.tsx",
  "components/workspaces/WorkspaceTasksPanel.tsx",
  "pages/maps/canvas.tsx",
];
const BANNED = ["href={`/workspaces/", "navigate(`/workspaces/", "navigate(`${APP_BASE}/workspaces/"];

describe("links que não saem de /embed", () => {
  it.each(FILES)("%s não navega com prefixo literal", (f) => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");
    for (const b of BANNED) expect(src.includes(b), `${f} contém ${b}`).toBe(false);
  });
});
