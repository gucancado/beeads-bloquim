import { describe, it, expect, vi } from "vitest";
import { changedMessage, readyMessage } from "@/lib/embedBridge";
import {
  embedParentOrigin,
  isEmbedded,
  postToEmbedParent,
  rememberEmbedParent,
  resetEmbedParentForTests,
} from "@/lib/embedParent";

const PAINEL = "https://painel.beeads.com.br";
const WS = "11111111-2222-3333-4444-555555555555";

describe("embedParent", () => {
  it("postToEmbedParent é no-op antes do init e posta depois", () => {
    resetEmbedParentForTests();
    const target = { postMessage: vi.fn() };
    expect(embedParentOrigin()).toBeNull();
    expect(postToEmbedParent(readyMessage(), target)).toBe(false);
    expect(target.postMessage).not.toHaveBeenCalled();
    rememberEmbedParent(PAINEL);
    expect(embedParentOrigin()).toBe(PAINEL);
    expect(postToEmbedParent(changedMessage("tasks"), target)).toBe(true);
    expect(target.postMessage).toHaveBeenCalledWith(
      { source: "bloquim-embed", type: "changed", what: "tasks" },
      PAINEL,
    );
  });

  it("isEmbedded lê o pathname recebido", () => {
    expect(isEmbedded(`/embed/workspaces/${WS}/tasks`)).toBe(true);
    expect(isEmbedded(`/workspaces/${WS}`)).toBe(false);
  });
});
