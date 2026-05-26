import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useTheme } from "next-themes";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import { useCreateWorkspace, useGetMe } from "@workspace/api-client-react";
import { FolderGit2, Plus, Loader2, EyeOff, Eye, Trash2 } from "lucide-react";
import { COLOR_PALETTE, getColorByIndex } from "@workspace/db/colorPalette";
import { Button } from "@beeads/ui";
import { Input } from "@beeads/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@beeads/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@beeads/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@beeads/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useListWorkspacesWithHidden, useToggleWorkspaceHidden, useDeleteWorkspace, useUpdateWorkspaceColor } from "@/hooks/useHidden";
import { Avatar, AvatarImage, AvatarFallback } from "@beeads/ui";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@beeads/ui";

function translateRole(role: string) {
  switch (role) {
    case 'admin': return 'Administrador';
    case 'editor': return 'Editor';
    case 'executor': return 'Executor';
    default: return role;
  }
}

type StatusDetail = { total: number; overdue: number; noDue: number };
type TaskCounts = {
  total: number;
  completed: number;
  blocked: number;
  draft: StatusDetail;
  pending: StatusDetail;
  in_progress: StatusDetail;
};

const STATUS_ROWS: Array<{
  key: "draft" | "pending" | "in_progress";
  label: string;
  labelColor: string;
}> = [
  { key: "draft",       label: "rascunho",     labelColor: "text-purple-700 dark:text-purple-400" },
  { key: "pending",     label: "pendentes",    labelColor: "text-blue-700 dark:text-blue-400" },
  { key: "in_progress", label: "em andamento", labelColor: "text-amber-700 dark:text-amber-400" },
];

type WorkspaceMemberPreview = {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string;
};

const MAX_VISIBLE_AVATARS = 5;

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

function WorkspaceCard({ ws, showHidden }: {
  ws: { id: string; name: string; hidden: boolean; role: string; colorIndex?: number | null; taskCounts?: TaskCounts; members?: WorkspaceMemberPreview[] };
  showHidden: boolean;
}) {
  const toggleHidden = useToggleWorkspaceHidden(ws.id);
  const deleteWorkspace = useDeleteWorkspace(ws.id);
  const colorMutation = useUpdateWorkspaceColor(ws.id);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const { toast } = useToast();
  const isAdmin = ws.role === "admin";
  const { resolvedTheme } = useTheme();
  const spaceColor = getColorByIndex(ws.colorIndex);
  const iconBg = spaceColor ?? (resolvedTheme === "dark" ? "#374151" : "#e5e7eb");

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleHidden.mutate(!ws.hidden);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = () => {
    deleteWorkspace.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Espaço excluído com sucesso!" });
      },
      onError: () => {
        toast({ title: "Falha ao excluir espaço", variant: "destructive" });
      },
    });
  };

  const emptyDetail = (): StatusDetail => ({ total: 0, overdue: 0, noDue: 0 });
  const base = ws.taskCounts;
  const counts: TaskCounts = {
    total: base?.total ?? 0,
    completed: base?.completed ?? 0,
    blocked: base?.blocked ?? 0,
    draft: base?.draft ?? emptyDetail(),
    pending: base?.pending ?? emptyDetail(),
    in_progress: base?.in_progress ?? emptyDetail(),
  };
  const hasAnyCounts = STATUS_ROWS.some((r) => counts[r.key].total > 0);
  const noTasks = counts.total === 0;
  const allCompleted = counts.total > 0 && counts.completed === counts.total;

  return (
    <div className={`relative group ${ws.hidden ? 'opacity-60' : ''}`}>
      <Link href={`/workspaces/${ws.id}`}>
        <div className="group/card bg-card p-6 rounded-3xl border border-border/60 shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300 cursor-pointer flex flex-col h-full hover:-translate-y-1">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-end gap-2.5 min-w-0">
              <div className="relative shrink-0">
                <span
                  className={`block w-5 h-5 rounded-sm transition-colors ${isAdmin ? "invisible" : ""}`}
                  style={{ backgroundColor: iconBg }}
                />
              </div>
              <h3 className="text-xl font-medium font-display text-foreground group-hover/card:text-primary transition-colors truncate">{ws.name}</h3>
            </div>
            {ws.hidden && (
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 lowercase">
                <EyeOff className="w-3 h-3" /> Oculto
              </span>
            )}
          </div>
          {noTasks ? (
            <p className="text-[13px] text-muted-foreground mt-3 lowercase">Sem tarefas</p>
          ) : allCompleted ? (
            <p className="text-[13px] text-emerald-600 dark:text-emerald-400 font-medium mt-3 lowercase">Tarefas concluídas</p>
          ) : hasAnyCounts ? (
            <div className="flex flex-col gap-1 mt-3">
              {STATUS_ROWS.map((row) => {
                const detail = counts[row.key];
                if (detail.total === 0) return null;
                return (
                  <div key={row.key} className="flex items-center gap-1.5">
                    <span className={`text-[12px] font-semibold lowercase ${row.labelColor}`}>
                      {detail.total} {row.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {detail.overdue > 0 && (
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger render={(props) => (
                              <span {...props} className="text-[11px] font-semibold text-red-600 dark:text-red-400 cursor-default">{detail.overdue}</span>
                            )} />
                            <TooltipContent side="top"><p>atrasadas</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {detail.noDue > 0 && (
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger render={(props) => (
                              <span {...props} className="text-[11px] font-medium text-muted-foreground cursor-default">{detail.noDue}</span>
                            )} />
                            <TooltipContent side="top"><p>sem prazo</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground mt-3 lowercase">nada.</p>
          )}
          <div className="mt-auto pt-6">
            {ws.members && ws.members.length > 0 && (
              <TooltipProvider delayDuration={200}>
                <div className="flex items-center mb-4">
                  <div className="flex -space-x-2 isolate">
                    {ws.members.slice(0, MAX_VISIBLE_AVATARS).map((member, index) => (
                      <Tooltip key={member.id}>
                        <TooltipTrigger render={(props) => (
                          <Avatar
                            {...props}
                            className="w-7 h-7 border-2 border-card ring-0 cursor-default hover:z-10 transition-transform hover:scale-110"
                            style={{ zIndex: MAX_VISIBLE_AVATARS - index }}
                          >
                            {member.avatarUrl ? (
                              <AvatarImage src={member.avatarUrl} alt={member.name} />
                            ) : null}
                            <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">
                              {getInitials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                        )} />
                        <TooltipContent side="top">
                          <p className="font-medium">{member.name}</p>
                          <p className="text-primary-foreground/70 text-[11px]">{translateRole(member.role)}</p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  {ws.members.length > MAX_VISIBLE_AVATARS && (
                    <span className="ml-2 text-[11px] font-medium text-muted-foreground">
                      +{ws.members.length - MAX_VISIBLE_AVATARS}
                    </span>
                  )}
                </div>
              </TooltipProvider>
            )}
          </div>
        </div>
      </Link>

      {isAdmin && (
        <Popover open={colorPopoverOpen} onOpenChange={setColorPopoverOpen}>
          <PopoverTrigger render={(props) => (
            <button
              {...props}
              type="button"
              title="Escolher cor"
              className="absolute top-6 left-6 w-5 h-5 rounded-sm transition-colors hover:ring-2 hover:ring-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/50 z-10"
              style={{ backgroundColor: iconBg }}
            />
          )} />
          <PopoverContent className="w-auto p-3 z-50" align="start">
            <div className="grid grid-cols-8 gap-1.5">
              {COLOR_PALETTE.map((entry) => {
                const isSelected = ws.colorIndex === entry.index;
                return (
                  <button
                    key={entry.index}
                    onClick={() => {
                      colorMutation.mutate(entry.index);
                      setColorPopoverOpen(false);
                    }}
                    className={`p-0.5 rounded-md transition-all ${isSelected ? "ring-2 ring-primary ring-offset-1" : "hover:scale-110"}`}
                  >
                    <span className="w-7 h-7 rounded-sm block" style={{ backgroundColor: entry.hex }} />
                  </button>
                );
              })}
            </div>
            {ws.colorIndex != null && (
              <button
                onClick={() => {
                  colorMutation.mutate(null);
                  setColorPopoverOpen(false);
                }}
                className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center lowercase"
              >
                remover cor
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}

      {isAdmin && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-10">
          <button
            onClick={handleToggle}
            disabled={toggleHidden.isPending}
            title={ws.hidden ? "Tornar visível" : "Ocultar espaço"}
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-background border border-border shadow-sm hover:border-slate-400 dark:hover:border-slate-500 text-muted-foreground hover:text-foreground"
          >
            {toggleHidden.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : ws.hidden ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={handleDeleteClick}
            disabled={deleteWorkspace.isPending}
            title="Excluir espaço"
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-background border border-border shadow-sm hover:border-red-400 dark:hover:border-red-500 text-muted-foreground hover:text-red-500"
          >
            {deleteWorkspace.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="lowercase">Excluir espaço de trabalho?</AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              Esta ação é permanente e não pode ser desfeita. O espaço "{ws.name}" e todos os seus planos e tarefas serão excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl lowercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl lowercase bg-red-600 hover:bg-red-700 text-white"
              onClick={handleConfirmDelete}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function useSidebarOrder() {
  return useQuery<Array<{ id: string }>>({
    queryKey: ["/api/sidebar/workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/sidebar/workspaces", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch sidebar order");
      return res.json();
    },
  });
}

export default function WorkspacesPage() {
  const [showHidden, setShowHidden] = useState(false);
  const { data: workspaces, isLoading } = useListWorkspacesWithHidden(showHidden);
  const { data: sidebarOrder } = useSidebarOrder();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetMe();

  const isAdmin = workspaces?.some((ws) => ws.role === "admin") ?? false;

  const filterMembers = useMemo(() => {
    if (!workspaces || !me?.id) return [];
    const meEntry = { userId: me.id, name: me.name, avatarUrl: (me as { avatarUrl?: string | null }).avatarUrl ?? null };
    const memberMap = new Map<string, { userId: string; name: string; avatarUrl: string | null }>();
    for (const ws of workspaces) {
      if (ws.hidden) continue;
      for (const m of ws.members ?? []) {
        if (m.userId !== me.id && !memberMap.has(m.userId)) {
          memberMap.set(m.userId, { userId: m.userId, name: m.name, avatarUrl: m.avatarUrl });
        }
      }
    }
    return [meEntry, ...Array.from(memberMap.values())];
  }, [workspaces, me?.id, me?.name]);

  const filteredWorkspaces = useMemo(() => {
    if (!workspaces) return [];
    let list = workspaces;
    if (selectedUserIds.length > 0) {
      list = workspaces.filter((ws) => {
        const members = ws.members ?? [];
        return selectedUserIds.some((uid) => {
          if (uid === me?.id) {
            return members.length === 1 && members[0].userId === me.id;
          }
          return members.some((m) => m.userId === uid);
        });
      });
    }
    if (sidebarOrder && sidebarOrder.length > 0) {
      const orderMap = new Map(sidebarOrder.map((s, i) => [s.id, i]));
      return [...list].sort((a, b) => {
        const aIdx = orderMap.get(a.id) ?? Infinity;
        const bIdx = orderMap.get(b.id) ?? Infinity;
        return aIdx - bIdx;
      });
    }
    return list;
  }, [workspaces, selectedUserIds, me?.id, sidebarOrder]);

  const toggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const createMutation = useCreateWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sidebar/workspaces"] });
        setIsOpen(false);
        setName("");
        toast({ title: "Espaço criado com sucesso!" });
      },
      onError: () => {
        toast({ title: "Falha ao criar espaço", variant: "destructive" });
      }
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ data: { name } });
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-8 lg:p-12">
          <PageBreadcrumb items={[{ label: "espaços de trabalho" }]} className="mb-4" />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div />

            <div className="flex items-center gap-3">
              {isAdmin && (
                <Button
                  variant="ghost"
                  className="rounded-xl h-12 w-12 p-0"
                  onClick={() => setShowHidden((v) => !v)}
                  aria-label={showHidden ? "Ocultar ocultos" : "Ver ocultos"}
                  title={showHidden ? "Ocultar ocultos" : "Ver ocultos"}
                >
                  {showHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              )}

              <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger render={(props) => (
                  <Button {...props} title="novo espaço" className="rounded-xl px-4 h-12 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all">
                    <Plus className="w-5 h-5" />
                  </Button>
                )} />
                <DialogContent className="sm:max-w-md rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-2xl font-display font-medium tracking-tight lowercase">
                      Criar <span className="italic text-honey-deep">·</span> Espaço de Trabalho
                    </DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreate} className="space-y-6 mt-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium lowercase">Nome do Espaço</label>
                      <Input 
                        placeholder="ex: Equipe de Engenharia, Projetos Pessoais" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-12 rounded-xl"
                        autoFocus
                      />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsOpen(false)} className="rounded-xl lowercase">
                        Cancelar
                      </Button>
                      <Button type="submit" disabled={createMutation.isPending || !name.trim()} className="rounded-xl lowercase">
                        {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {filterMembers.length > 0 && (
            <TooltipProvider delayDuration={200}>
              <div className="flex items-center gap-2 mb-6 flex-wrap">
                {filterMembers.map((member) => {
                  const isSelected = selectedUserIds.includes(member.userId);
                  const anySelected = selectedUserIds.length > 0;
                  return (
                    <Tooltip key={member.userId}>
                      <TooltipTrigger render={(props) => (
                        <button
                          {...props}
                          onClick={() => toggleUser(member.userId)}
                          className={`transition-all duration-200 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                            anySelected && !isSelected ? "grayscale opacity-60 scale-100" : "scale-100"
                          } ${isSelected ? "scale-110 ring-2 ring-primary ring-offset-2" : ""}`}
                        >
                          <Avatar className="w-9 h-9 border-2 border-card cursor-pointer">
                            {member.avatarUrl ? (
                              <AvatarImage src={member.avatarUrl} alt={member.name} />
                            ) : null}
                            <AvatarFallback className="text-[11px] font-semibold bg-primary/10 text-primary">
                              {getInitials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                        </button>
                      )} />
                      <TooltipContent side="bottom">
                        <p className="font-medium">{member.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
          )}

          {showHidden && (
            <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-sm text-amber-700 dark:text-amber-400">
              <EyeOff className="w-4 h-4 shrink-0" />
              <span className="lowercase">Mostrando espaços ocultos. Apenas administradores podem ver e restaurar espaços ocultos.</span>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-3xl border border-border shadow-sm">
              <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-6">
                <FolderGit2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-medium font-display text-foreground lowercase">
                {selectedUserIds.length > 0 ? "Nenhum espaço com esses membros" : showHidden ? "Nenhum espaço oculto" : "Nenhum espaço ainda"}
              </h3>
              <p className="text-muted-foreground mt-2 mb-8 max-w-md mx-auto lowercase">
                {selectedUserIds.length > 0
                  ? "Nenhum espaço de trabalho compartilhado com os membros selecionados."
                  : showHidden
                  ? "Você não possui espaços ocultos no momento."
                  : "Crie um espaço para começar a organizar seus planos e tarefas."}
              </p>
              {!showHidden && selectedUserIds.length === 0 && (
                <Button onClick={() => setIsOpen(true)} className="rounded-xl px-8 h-12 lowercase">
                  Criar primeiro espaço
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredWorkspaces.map((ws) => (
                <WorkspaceCard key={ws.id} ws={ws} showHidden={showHidden} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
