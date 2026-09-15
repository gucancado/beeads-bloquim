import { describe, it, expect } from "vitest";
import {
  EMBED_CHILD_SOURCE,
  EMBED_PARENT_SOURCE,
  allowedParentOrigins,
  closedMessage,
  forcedEmbedTheme,
  isEmbedPath,
  parseParentMessage,
  readyMessage,
} from "./embedBridge";

// Fixtures ESPELHADAS em beeads-central-de-dados/web/src/lib/task-embed-bridge.check.ts.
const PAINEL = "https://painel.beeads.com.br";
const WS = "b2c49094-d3b8-4408-ad36-d439e4fdb517";
const TASK = "0f7a3c2e-1b4d-4e5f-9a6b-7c8d9e0f1a2b";
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
