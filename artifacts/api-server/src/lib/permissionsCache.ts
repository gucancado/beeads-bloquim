/**
 * In-memory cache for (userId, workspaceId) → role lookups.
 *
 * `requireWorkspaceRole` runs on every workspace-scoped request, hitting the
 * DB for the same row dozens of times per minute (canvas polls, sidebar,
 * task lists). A short TTL absorbs that storm without making role revocation
 * dangerously stale.
 *
 * Trade-off: a role change (admin demotes a user, removes them from a
 * workspace) takes up to TTL_MS to propagate to all api-server replicas.
 * Today there's a single replica and the TTL is short enough that this is
 * fine; if you ever need instant revocation, restart the process or call
 * invalidate() from the member-mutation routes.
 */

type Role = "admin" | "editor" | "executor";

type Entry = { role: Role | null; expiresAt: number };

const TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;

const cache = new Map<string, Entry>();

function key(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`;
}

export function getCachedRole(workspaceId: string, userId: string): Role | null | undefined {
  const k = key(workspaceId, userId);
  const entry = cache.get(k);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(k);
    return undefined;
  }
  return entry.role;
}

export function setCachedRole(workspaceId: string, userId: string, role: Role | null): void {
  if (cache.size >= MAX_ENTRIES) {
    // Drop the oldest entry. Map iteration order = insertion order, so the
    // first key is the oldest. Cheap O(1) eviction without an LRU lib.
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key(workspaceId, userId), { role, expiresAt: Date.now() + TTL_MS });
}

export function invalidateRole(workspaceId: string, userId: string): void {
  cache.delete(key(workspaceId, userId));
}

export function invalidateWorkspace(workspaceId: string): void {
  const prefix = `${workspaceId}:`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}
