import { describe, it, expect } from "vitest";
import {
  EMBED_CHILD_SOURCE,
  EMBED_PARENT_SOURCE,
  allowedParentOrigins,
  changedMessage,
  closedMessage,
  forcedEmbedTheme,
  isAllowedEmbedPath,
  isEmbedPath,
  navigateMessage,
  parseParentCommand,
  parseParentMessage,
  readyMessage,
  workspaceRouteBase,
} from "./embedBridge";

// Fixtures ESPELHADAS em beeads-central-de-dados/web/src/lib/task-embed-bridge.check.ts.
const PAINEL = "https://painel.beeads.com.br";
const WS = "b2c49094-d3b8-4408-ad36-d439e4fdb517";
const TASK = "0f7a3c2e-1b4d-4e5f-9a6b-7c8d9e0f1a2b";
const MAP = "7d2f9b1c-3a4e-4f50-8b6c-9d0e1f2a3b4c";
const open = (extra: Record<string, unknown> = {}) => ({
  source: "bcd-panel",
  type: "open",
  workspaceId: WS,
  taskId: null,
  ...extra,
});

describe("allowedParentOrigins", () => {
  it("prod só aceita o painel", () => {
    expect(allowedParentOrigins(false)).toEqual([PAINEL]);
  });
  it("dev aceita também o painel local", () => {
    expect(allowedParentOrigins(true)).toEqual([PAINEL, "http://localhost:3001"]);
  });
});

describe("parseParentMessage", () => {
  const allowed = allowedParentOrigins(false);

  it("aceita open válido do painel (nova tarefa)", () => {
    expect(parseParentMessage(PAINEL, open(), allowed)).toEqual({
      source: EMBED_PARENT_SOURCE,
      type: "open",
      workspaceId: WS,
      taskId: null,
    });
  });

  it("aceita taskId string (edição de tarefa existente)", () => {
    expect(parseParentMessage(PAINEL, open({ taskId: TASK }), allowed)?.taskId).toBe(TASK);
  });

  it("recusa origem fora da allowlist", () => {
    expect(parseParentMessage("https://evil.example", open(), allowed)).toBeNull();
    expect(parseParentMessage("http://localhost:3001", open(), allowed)).toBeNull();
  });

  it("aceita localhost quando a allowlist é a de dev", () => {
    expect(parseParentMessage("http://localhost:3001", open(), allowedParentOrigins(true))).not.toBeNull();
  });

  it("recusa source ou type errados", () => {
    expect(parseParentMessage(PAINEL, open({ source: "outro" }), allowed)).toBeNull();
    expect(parseParentMessage(PAINEL, open({ type: "close" }), allowed)).toBeNull();
  });

  it("recusa workspaceId ausente, vazio ou não-string", () => {
    expect(parseParentMessage(PAINEL, open({ workspaceId: undefined }), allowed)).toBeNull();
    expect(parseParentMessage(PAINEL, open({ workspaceId: "  " }), allowed)).toBeNull();
    expect(parseParentMessage(PAINEL, open({ workspaceId: 42 }), allowed)).toBeNull();
  });

  it("recusa taskId ausente, vazio ou não-string", () => {
    const { taskId: _omit, ...semTask } = open();
    expect(parseParentMessage(PAINEL, semTask, allowed)).toBeNull();
    expect(parseParentMessage(PAINEL, open({ taskId: "" }), allowed)).toBeNull();
    expect(parseParentMessage(PAINEL, open({ taskId: 7 }), allowed)).toBeNull();
  });

  it("recusa data que não é objeto", () => {
    expect(parseParentMessage(PAINEL, null, allowed)).toBeNull();
    expect(parseParentMessage(PAINEL, "open", allowed)).toBeNull();
  });
});

describe("mensagens do filho", () => {
  it("ready e closed carregam o source do embed", () => {
    expect(readyMessage()).toEqual({ source: EMBED_CHILD_SOURCE, type: "ready" });
    expect(closedMessage()).toEqual({ source: EMBED_CHILD_SOURCE, type: "closed" });
  });
});

describe("forcedEmbedTheme", () => {
  it("dark só com theme=dark; qualquer outra coisa é light", () => {
    expect(forcedEmbedTheme("?theme=dark")).toBe("dark");
    expect(forcedEmbedTheme("?theme=light")).toBe("light");
    expect(forcedEmbedTheme("")).toBe("light");
    expect(forcedEmbedTheme("?theme=roxo")).toBe("light");
  });
});

describe("isEmbedPath", () => {
  it("só caminhos sob /embed", () => {
    expect(isEmbedPath("/embed/task")).toBe(true);
    expect(isEmbedPath("/embed")).toBe(true);
    expect(isEmbedPath("/embedded")).toBe(false);
    expect(isEmbedPath("/my-tasks")).toBe(false);
  });
});

describe("isAllowedEmbedPath", () => {
  it("aceita lista, deep link de tarefa e mapa", () => {
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/tasks`)).toBe(true);
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/tasks/${TASK}`)).toBe(true);
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/maps/${MAP}`)).toBe(true);
  });
  it("recusa fora de /embed, query, segmentos extras e ..", () => {
    expect(isAllowedEmbedPath(`/workspaces/${WS}/tasks`)).toBe(false);
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/maps/${MAP}?cardId=x`)).toBe(false);
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/maps/${MAP}/x`)).toBe(false);
    expect(isAllowedEmbedPath(`/embed/workspaces/../tasks`)).toBe(false);
    expect(isAllowedEmbedPath("https://evil.example/embed/workspaces/x/tasks")).toBe(false);
  });
});

describe("parseParentCommand", () => {
  const allowed = allowedParentOrigins(false);
  it("aceita init com returnUrl do painel", () => {
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "init", returnUrl: `${PAINEL}/bluma-cf/tarefas` }, allowed))
      .toEqual({ source: "bcd-panel", type: "init", returnUrl: `${PAINEL}/bluma-cf/tarefas` });
  });
  it("recusa init com returnUrl de outra origem ou inválida", () => {
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "init", returnUrl: "https://evil.example/x" }, allowed)).toBeNull();
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "init", returnUrl: "not a url" }, allowed)).toBeNull();
  });
  it("aceita navigate com path permitido e recusa o resto", () => {
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "navigate", path: `/embed/workspaces/${WS}/maps/${MAP}` }, allowed))
      .toEqual({ source: "bcd-panel", type: "navigate", path: `/embed/workspaces/${WS}/maps/${MAP}` });
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "navigate", path: `/workspaces/${WS}` }, allowed)).toBeNull();
  });
  it("recusa origem fora da allowlist e open (que é do parseParentMessage)", () => {
    expect(parseParentCommand("https://evil.example", { source: "bcd-panel", type: "init", returnUrl: PAINEL }, allowed)).toBeNull();
    expect(parseParentCommand(PAINEL, open(), allowed)).toBeNull();
  });
});

describe("mensagens do filho", () => {
  it("navigate tasks / map", () => {
    expect(navigateMessage({ kind: "tasks" })).toEqual({ source: EMBED_CHILD_SOURCE, type: "navigate", target: "tasks" });
    expect(navigateMessage({ kind: "map", mapId: MAP })).toEqual({ source: EMBED_CHILD_SOURCE, type: "navigate", target: "map", mapId: MAP });
  });
  it("changed", () => {
    expect(changedMessage("plans")).toEqual({ source: EMBED_CHILD_SOURCE, type: "changed", what: "plans" });
  });
});

describe("workspaceRouteBase", () => {
  it("prefixa /embed só em rota de embed", () => {
    expect(workspaceRouteBase(WS, `/embed/workspaces/${WS}/tasks`)).toBe(`/embed/workspaces/${WS}`);
    expect(workspaceRouteBase(WS, `/workspaces/${WS}`)).toBe(`/workspaces/${WS}`);
    expect(workspaceRouteBase(WS, "/embed/task")).toBe(`/embed/workspaces/${WS}`);
  });
});
