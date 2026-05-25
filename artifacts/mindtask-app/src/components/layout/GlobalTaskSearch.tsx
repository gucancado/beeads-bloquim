import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, X, Loader2, Calendar, SlidersHorizontal, Check, ChevronDown, AlertTriangle } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@beeads/ui";
import { translatePriority, getPriorityColor } from "@/components/tasks/priorityUtils";
import { useMyWorkspaces } from "@/hooks/useProfile";
import { TASK_STATUS_ORDER, getStatusOrderEntry } from "@/lib/taskStatusConstants";

type SearchResult = {
  id: string;
  mapId: string | null;
  workspaceId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  workspaceName: string | null;
  workspaceColorIndex: number | null;
  mapName: string | null;
};

const STATUS_OPTIONS = TASK_STATUS_ORDER;

const DEFAULT_STATUSES = ["in_progress", "draft", "pending"];

const OVERDUE_CLASS = "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";

function formatDueDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function getInitials(name: string | null) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

function descriptionSnippet(text: string | null, query: string, max = 120): string | null {
  if (!text) return null;
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  const lower = plain.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) {
    return plain.length > max ? plain.slice(0, max) + "…" : plain;
  }
  const start = Math.max(0, idx - 30);
  const end = Math.min(plain.length, start + max);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < plain.length ? "…" : "";
  return prefix + plain.slice(start, end) + suffix;
}

function arraysEqualAsSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

export function GlobalTaskSearch() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const [statuses, setStatuses] = useState<string[]>(DEFAULT_STATUSES);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtersBtnRef = useRef<HTMLButtonElement>(null);
  const filtersPanelRef = useRef<HTMLDivElement>(null);

  const { data: myWorkspaces } = useMyWorkspaces();
  const visibleWorkspaces = useMemo(
    () => (myWorkspaces ?? []).filter((w) => !w.hidden),
    [myWorkspaces],
  );

  // Global Ctrl+F / Cmd+F shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isFind = (e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F");
      if (!isFind) return;
      e.preventDefault();
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus when opened; reset state on close.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
      setDebounced("");
      setResults([]);
      setError(false);
      setLoading(false);
      setFiltersOpen(false);
      setWsDropdownOpen(false);
      setStatuses(DEFAULT_STATUSES);
      setWorkspaceId(null);
    }
  }, [open]);

  // Click outside closes everything (search + filters dropdown).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Debounce input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Run search
  useEffect(() => {
    if (!open) return;
    if (debounced.length < 2) {
      setResults([]);
      setLoading(false);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    params.set("q", debounced);
    if (statuses.length > 0) params.set("status", statuses.join(","));
    if (workspaceId) params.set("workspaceId", workspaceId);
    customFetch<SearchResult[]>(`/api/tasks/search?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setResults(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setResults([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open, statuses, workspaceId]);

  const openTask = (t: SearchResult) => {
    if (t.workspaceId) {
      navigate(`/workspaces/${t.workspaceId}/tasks/${t.id}`);
    } else {
      navigate(`/my-tasks/tasks/${t.id}`);
    }
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (filtersOpen) {
        setFiltersOpen(false);
      } else {
        setOpen(false);
      }
    }
  };

  const toggleStatus = (value: string) => {
    setStatuses((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  };

  const trimmedQuery = query.trim();
  const showDropdown = open && trimmedQuery.length >= 2 && debounced.length >= 2;

  const filtersChanged =
    !arraysEqualAsSet(statuses, DEFAULT_STATUSES) || workspaceId !== null;

  const selectedWs = workspaceId
    ? visibleWorkspaces.find((w) => w.id === workspaceId) ?? null
    : null;

  return (
    <div ref={containerRef} className="absolute top-4 right-4 z-30">
      {!open ? (
        <button
          type="button"
          title="buscar tarefas (Ctrl+F)"
          onClick={() => setOpen(true)}
          className="w-10 h-10 rounded-xl bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
        >
          <Search className="w-4 h-4" />
        </button>
      ) : (
        <div className="w-[420px] max-w-[calc(100vw-2rem)]">
          <div className="flex items-center gap-2 bg-card border border-border rounded-xl shadow-lg px-3 h-10">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="buscar tarefas…"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            />
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
            <button
              ref={filtersBtnRef}
              type="button"
              title="filtros"
              onClick={() => setFiltersOpen((v) => !v)}
              className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                filtersChanged
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="fechar"
              onClick={() => setOpen(false)}
              className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {filtersOpen && (
            <div
              ref={filtersPanelRef}
              className="mt-2 bg-popover border border-border rounded-xl shadow-xl p-3 flex flex-col gap-3"
            >
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_OPTIONS.map((opt) => {
                    const active = statuses.includes(opt.value);
                    const OptIcon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleStatus(opt.value)}
                        title={opt.label}
                        aria-label={opt.label}
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full border transition-all ${
                          active
                            ? opt.activeClass
                            : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
                        }`}
                      >
                        <OptIcon className="w-3.5 h-3.5" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setWsDropdownOpen((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs rounded-lg border border-border bg-card hover:border-primary/50 transition-colors"
                  >
                    <span className={`truncate lowercase ${selectedWs ? "text-foreground" : "text-muted-foreground"}`}>
                      {selectedWs ? selectedWs.name : "todos os espaços"}
                    </span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                  </button>
                  {wsDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg py-1 max-h-60 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceId(null);
                          setWsDropdownOpen(false);
                        }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-muted text-left lowercase"
                      >
                        <span>todos os espaços</span>
                        {workspaceId === null && <Check className="w-3 h-3 text-primary shrink-0" />}
                      </button>
                      {visibleWorkspaces.length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground italic lowercase">
                          nenhum espaço disponível
                        </div>
                      )}
                      {visibleWorkspaces.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => {
                            setWorkspaceId(w.id);
                            setWsDropdownOpen(false);
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-muted text-left lowercase"
                        >
                          <span className="truncate">{w.name}</span>
                          {workspaceId === w.id && <Check className="w-3 h-3 text-primary shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {filtersChanged && (
                <button
                  type="button"
                  onClick={() => {
                    setStatuses(DEFAULT_STATUSES);
                    setWorkspaceId(null);
                  }}
                  className="self-end text-[11px] text-muted-foreground hover:text-foreground lowercase"
                >
                  restaurar padrão
                </button>
              )}
            </div>
          )}

          {showDropdown && (
            <div className="mt-2 bg-popover border border-border rounded-xl shadow-xl max-h-[60vh] overflow-y-auto">
              {error ? (
                <div className="px-4 py-6 text-sm text-rose-600 dark:text-rose-400 lowercase">
                  Não foi possível realizar a busca.
                </div>
              ) : loading && results.length === 0 ? (
                <div className="px-4 py-6 flex items-center justify-center text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              ) : results.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground lowercase text-center">
                  Nenhuma tarefa encontrada.
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {results.map((t) => {
                    const snippet = descriptionSnippet(t.description, debounced);
                    const due = formatDueDate(t.dueDate);
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => openTask(t)}
                          className="w-full text-left px-4 py-3 hover:bg-accent/60 transition-colors flex flex-col gap-1.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-sm font-medium text-foreground line-clamp-1 flex-1">
                              {t.title}
                            </span>
                            {(() => {
                              const entry = getStatusOrderEntry(t.status);
                              if (entry) {
                                const StatusIcon = entry.icon;
                                return (
                                  <span
                                    className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border ${entry.activeClass}`}
                                    title={entry.label}
                                    aria-label={entry.label}
                                  >
                                    <StatusIcon className="w-3.5 h-3.5" />
                                  </span>
                                );
                              }
                              if (t.status === "overdue") {
                                return (
                                  <span
                                    className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full ${OVERDUE_CLASS}`}
                                    title="atrasada"
                                    aria-label="atrasada"
                                  >
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                  </span>
                                );
                              }
                              return (
                                <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium lowercase bg-muted text-muted-foreground">
                                  {t.status}
                                </span>
                              );
                            })()}
                          </div>

                          {snippet && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{snippet}</p>
                          )}

                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground mt-0.5">
                            {t.assigneeName ? (
                              <span className="inline-flex items-center gap-1">
                                <Avatar className="w-4 h-4">
                                  {t.assigneeAvatarUrl && (
                                    <AvatarImage src={t.assigneeAvatarUrl} alt={t.assigneeName} className="object-cover" />
                                  )}
                                  <AvatarFallback className="text-[8px] bg-primary/20 text-primary">
                                    {getInitials(t.assigneeName)}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="truncate max-w-[120px]">{t.assigneeName}</span>
                              </span>
                            ) : (
                              <span className="lowercase italic">sem responsável</span>
                            )}

                            <span className={`inline-flex items-center gap-1 ${getPriorityColor(t.priority)}`}>
                              <span className="lowercase">{translatePriority(t.priority)}</span>
                            </span>

                            {due && (
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                <span>{due}</span>
                              </span>
                            )}

                            {t.workspaceName && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted lowercase">
                                {t.workspaceName}
                              </span>
                            )}

                            {t.mapName && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted lowercase">
                                {t.mapName}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
