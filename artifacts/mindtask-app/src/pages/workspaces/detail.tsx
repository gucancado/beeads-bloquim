import { useState, useRef, useEffect, useCallback } from "react";
import { useRoute, Link, useSearch } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetWorkspace, useCreateMap, useGetDashboard, useRemoveWorkspaceMember, useListWorkspaceMembers, usePatchWorkspaceMemberRole, useGetMe, customFetch } from "@workspace/api-client-react";
import { useListMapsWithHidden, useToggleMapHidden, useDeleteMap } from "@/hooks/useHidden";
import { Map, Plus, Users, Settings, LayoutDashboard, Loader2, ArrowRight, BarChart3, UserPlus, Trash2, ShieldAlert, Shield, User, EyeOff, Eye, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { AssigneeFilterPills } from "@/components/tasks/AssigneeFilterPills";
import { TaskListItem, TaskListItemMember } from "@/components/tasks/TaskListItem";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

import { COLOR_PALETTE, getColorByIndex } from "@workspace/db/colorPalette";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

function translateRoleLabel(role: string) {
  switch (role) {
    case 'admin': return 'Administrador';
    case 'editor': return 'Editor';
    case 'executor': return 'Executor';
    default: return role;
  }
}

function MapCard({ map, workspaceId, isAdmin }: {
  map: { id: string; name: string; hidden: boolean; updatedAt: string };
  workspaceId: string;
  isAdmin: boolean;
}) {
  const toggleHidden = useToggleMapHidden(workspaceId, map.id);
  const deleteMap = useDeleteMap(workspaceId, map.id);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const { toast } = useToast();

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleHidden.mutate(!map.hidden);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = () => {
    deleteMap.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Plano excluído com sucesso!" });
      },
      onError: () => {
        toast({ title: "Falha ao excluir plano", variant: "destructive" });
      },
    });
  };

  return (
    <div className={`relative group ${map.hidden ? 'opacity-60' : ''}`}>
      <Link href={`/workspaces/${workspaceId}/maps/${map.id}`}>
        <div className="group/card bg-card rounded-2xl p-6 border border-border/60 shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300 cursor-pointer hover:-translate-y-1">
          <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center mb-5 group-hover/card:scale-110 transition-transform">
            <Map className="w-6 h-6" />
          </div>
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-lg font-bold font-display text-foreground group-hover/card:text-primary transition-colors">{map.name}</h3>
            {map.hidden && (
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 lowercase">
                <EyeOff className="w-3 h-3" /> Oculto
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 lowercase">Atualizado em {format(new Date(map.updatedAt), 'dd/MM/yyyy')}</p>
          <div className="mt-6 flex justify-end">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-foreground group-hover/card:bg-primary group-hover/card:text-primary-foreground transition-colors">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </Link>

      {isAdmin && (
        <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-10">
          <button
            onClick={handleToggle}
            disabled={toggleHidden.isPending}
            title={map.hidden ? "tornar visível" : "ocultar plano"}
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-background border border-border shadow-sm hover:border-slate-400 dark:hover:border-slate-500 text-muted-foreground hover:text-foreground"
          >
            {toggleHidden.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : map.hidden ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={handleDeleteClick}
            disabled={deleteMap.isPending}
            title="Excluir plano"
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-background border border-border shadow-sm hover:border-red-400 dark:hover:border-red-500 text-muted-foreground hover:text-red-500"
          >
            {deleteMap.isPending ? (
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
            <AlertDialogTitle className="lowercase">Excluir plano?</AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              Esta ação é permanente e não pode ser desfeita. O plano "{map.name}" e todos os seus dados serão excluídos.
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

const VALID_TABS = ["maps", "tasks", "dashboard", "members"] as const;
type TabValue = typeof VALID_TABS[number];

function isValidTab(v: string | null): v is TabValue {
  return VALID_TABS.includes(v as TabValue);
}

export default function WorkspaceDetailPage() {
  const [, params] = useRoute("/workspaces/:id");
  const workspaceId = params?.id || "";
  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab");
  const tabFromUrl: TabValue = isValidTab(tabParam) ? tabParam : "maps";
  const [activeTab, setActiveTab] = useState<TabValue>(tabFromUrl);

  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [workspaceId, tabFromUrl]);

  const { data: workspace, isLoading: isWsLoading } = useGetWorkspace(workspaceId);
  const { data: dashboard } = useGetDashboard(workspaceId);

  const [isMapDialogOpen, setIsMapDialogOpen] = useState(false);
  const [mapName, setMapName] = useState("");
  const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"admin" | "editor" | "executor">("editor");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, "admin" | "editor" | "executor">>({});
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [showHiddenMaps, setShowHiddenMaps] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["in_progress", "draft"]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [openCard, setOpenCard] = useState<{ workspaceId: string; mapId: string; cardId: string } | null>(null);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);

  const { data: maps, isLoading: isMapsLoading } = useListMapsWithHidden(workspaceId, showHiddenMaps);
  const { data: workspaceMembers } = useListWorkspaceMembers(workspaceId);

  const tasksQueryKey = [`/api/workspaces/${workspaceId}/tasks`, selectedStatuses, selectedAssignees];
  const { data: workspaceTasks, isLoading: isTasksLoading } = useQuery<any[]>({
    queryKey: tasksQueryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedStatuses.length > 0) p.set("status", selectedStatuses.join(","));
      if (selectedAssignees.length > 0) p.set("assignedTo", selectedAssignees.join(","));
      const qs = p.toString() ? `?${p.toString()}` : "";
      return customFetch(`/api/workspaces/${workspaceId}/tasks${qs}`);
    },
  });

  const countsQueryKey = [`/api/workspaces/${workspaceId}/tasks/counts`, selectedAssignees];
  const { data: statusCounts } = useQuery<Record<string, number>>({
    queryKey: countsQueryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedAssignees.length > 0) p.set("assignedTo", selectedAssignees.join(","));
      const qs = p.toString() ? `?${p.toString()}` : "";
      return customFetch(`/api/workspaces/${workspaceId}/tasks/counts${qs}`);
    },
  });

  const isAdmin = workspace?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const currentUserId = me?.id ?? "";

  const { data: memberSuggestions } = useQuery<{ userId: string; name: string; email: string; avatarUrl: string | null }[]>({
    queryKey: [`/api/workspaces/${workspaceId}/members/suggestions`],
    queryFn: () => customFetch(`/api/workspaces/${workspaceId}/members/suggestions`),
    enabled: isMemberDialogOpen && isAdmin,
  });

  const updateMemberRoleMutation = usePatchWorkspaceMemberRole({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/members`] });
        toast({ title: "Papel atualizado com sucesso!" });
      },
      onError: () => {
        toast({ title: "Falha ao atualizar papel", variant: "destructive" });
      },
    },
  });

  const createMapMutation = useCreateMap({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps`] });
        queryClient.invalidateQueries({ queryKey: ["/api/sidebar/workspaces"] });
        setIsMapDialogOpen(false);
        setMapName("");
        toast({ title: "Plano criado com sucesso!" });
      }
    }
  });

  const [isInviting, setIsInviting] = useState(false);

  const removeMemberMutation = useRemoveWorkspaceMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}`] });
        setRemovingMemberId(null);
        toast({ title: "Membro removido." });
      }
    }
  });

  const renameMutation = useMutation({
    mutationFn: async (newName: string) => {
      const token = localStorage.getItem("mindtask_token");
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed to rename workspace");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sidebar/workspaces"] });
    },
    onError: () => {
      toast({ title: "Falha ao renomear espaço", variant: "destructive" });
    },
  });

  const colorMutation = useMutation({
    mutationFn: async (colorIndex: number | null) => {
      const token = localStorage.getItem("mindtask_token");
      const res = await fetch(`/api/workspaces/${workspaceId}/color`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ colorIndex }),
      });
      if (!res.ok) throw new Error("Failed to update color");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/sidebar/workspaces"] });
    },
    onError: () => {
      toast({ title: "Falha ao atualizar a cor", variant: "destructive" });
    },
  });

  const startEditingTitle = useCallback(() => {
    if (!isAdmin) return;
    setEditTitleValue(workspace?.name ?? "");
    setIsEditingTitle(true);
  }, [isAdmin, workspace?.name]);

  const saveTitle = useCallback(() => {
    if (!isEditingTitle) return;
    const trimmed = editTitleValue.trim();
    setIsEditingTitle(false);
    if (!trimmed || trimmed === workspace?.name) return;
    renameMutation.mutate(trimmed);
  }, [isEditingTitle, editTitleValue, workspace?.name, renameMutation]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const toggleAssignee = (id: string) => {
    setSelectedAssignees(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const clearAllFilters = () => {
    setSelectedStatuses([]);
    setSelectedAssignees([]);
  };

  const handleCreateMap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapName.trim()) return;
    createMapMutation.mutate({ workspaceId, data: { name: mapName } });
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasEmail = memberEmail.trim().length > 0;
    const selectedUserIds = Object.keys(selectedSuggestions);
    if (!hasEmail && selectedUserIds.length === 0) return;

    setIsInviting(true);
    const promises: Promise<any>[] = [];

    if (hasEmail) {
      promises.push(
        customFetch(`/api/workspaces/${workspaceId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: memberEmail, role: memberRole }),
        })
      );
    }

    for (const uid of selectedUserIds) {
      const suggestion = memberSuggestions?.find((s) => s.userId === uid);
      if (suggestion) {
        promises.push(
          customFetch(`/api/workspaces/${workspaceId}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: suggestion.email, role: selectedSuggestions[uid] }),
          })
        );
      }
    }

    try {
      const results = await Promise.allSettled(promises);
      const failed = results.filter((r) => r.status === "rejected");
      const succeeded = results.filter((r) => r.status === "fulfilled");

      if (succeeded.length > 0) {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/members`] });
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/members/suggestions`] });
        toast({
          title: succeeded.length === 1
            ? "Membro adicionado com sucesso!"
            : `${succeeded.length} membros adicionados com sucesso!`,
        });
      }

      if (failed.length > 0) {
        toast({
          title: `Falha ao adicionar ${failed.length} membro${failed.length > 1 ? "s" : ""}`,
          description: "Verifique se os e-mails estão corretos e os usuários estão cadastrados.",
          variant: "destructive",
        });
      }

      if (failed.length === 0) {
        setIsMemberDialogOpen(false);
        setMemberEmail("");
        setMemberRole("editor");
        setSelectedSuggestions({});
      }
    } catch {
      toast({ title: "Falha ao adicionar membros", variant: "destructive" });
    } finally {
      setIsInviting(false);
    }
  };

  const translateRole = (role: string) => {
    switch (role) {
      case 'admin': return 'Admin';
      case 'editor': return 'Editor';
      case 'executor': return 'Executor';
      default: return role;
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin': return <ShieldAlert className="w-3.5 h-3.5" />;
      case 'editor': return <Shield className="w-3.5 h-3.5" />;
      default: return <User className="w-3.5 h-3.5" />;
    }
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 border border-red-200 dark:border-red-900/50';
      case 'editor': return 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50';
      default: return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700';
    }
  };

  const STATUS_OPTIONS = [
    { value: "in_progress", label: "em andamento", labelPlural: "em andamento", activeClass: "bg-amber-500 text-white border-amber-500 hover:bg-amber-600" },
    { value: "pending",     label: "pendente",      labelPlural: "pendentes",    activeClass: "bg-blue-500 text-white border-blue-500 hover:bg-blue-600" },
    { value: "draft",       label: "rascunho",      labelPlural: "rascunhos",    activeClass: "bg-purple-500 text-white border-purple-500 hover:bg-purple-600" },
    { value: "blocked",     label: "cancelada",     labelPlural: "canceladas",   activeClass: "bg-slate-500 text-white border-slate-500 hover:bg-slate-600" },
    { value: "completed",   label: "concluída",     labelPlural: "concluídas",   activeClass: "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600" },
  ];

  const toggleStatus = (value: string) => {
    setSelectedStatuses(prev =>
      prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]
    );
  };

  const handleClosePanel = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: tasksQueryKey });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    setOpenCard(null);
  };

  const handleDeleteCardFromPanel = () => {
    setOpenCard(null);
  };

  const handleCloseTaskSheet = () => {
    queryClient.invalidateQueries({ queryKey: tasksQueryKey });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    setTaskSheetOpen(false);
    setEditingTaskId(null);
  };

  const openTaskItem = (task: any) => {
    if (task.cardId && task.mapId) {
      setOpenCard({ workspaceId: task.workspaceId, mapId: task.mapId, cardId: task.cardId });
    } else {
      setEditingTaskId(task.id);
      setTaskSheetOpen(true);
    }
  };

  if (isWsLoading) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!workspace) return null;

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="bg-card border-b border-border pt-12 px-8 lg:px-12 pb-0">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 text-muted-foreground mb-4 text-sm">
              <Link href="/workspaces"><span className="hover:text-foreground cursor-pointer transition-colors lowercase">Espaços de Trabalho</span></Link>
              <span>/</span>
              <span className="text-foreground font-medium">{workspace.name}</span>
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8">
              <div>
                {isEditingTitle ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editTitleValue}
                    onChange={(e) => setEditTitleValue(e.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        saveTitle();
                      }
                      if (e.key === "Escape") {
                        setIsEditingTitle(false);
                      }
                    }}
                    className="text-4xl font-display font-bold text-foreground bg-transparent border-b-2 border-primary outline-none w-full"
                  />
                ) : (
                  <div className="flex items-center gap-3">
                    {isAdmin ? (
                      <Popover open={colorPopoverOpen} onOpenChange={setColorPopoverOpen}>
                        <PopoverTrigger asChild>
                          <button
                            title="Escolher cor"
                            className="shrink-0 w-5 h-5 rounded-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                            style={
                              getColorByIndex(workspace.colorIndex)
                                ? { backgroundColor: getColorByIndex(workspace.colorIndex)! }
                                : { border: "2px dashed #cbd5e1", backgroundColor: "transparent" }
                            }
                          />
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-3" align="start">
                          <div className="grid grid-cols-8 gap-1.5">
                            {COLOR_PALETTE.map((entry) => {
                              const isSelected = workspace.colorIndex === entry.index;
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
                          {workspace.colorIndex && (
                            <button
                              onClick={() => {
                                colorMutation.mutate(null);
                                setColorPopoverOpen(false);
                              }}
                              className="mt-2 w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center lowercase"
                            >
                              Remover cor
                            </button>
                          )}
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <span
                        className="shrink-0 w-5 h-5 rounded-sm"
                        style={
                          getColorByIndex(workspace.colorIndex)
                            ? { backgroundColor: getColorByIndex(workspace.colorIndex)! }
                            : { border: "2px dashed #cbd5e1", backgroundColor: "transparent" }
                        }
                      />
                    )}
                    <h1
                      className={`text-4xl font-display font-bold text-foreground ${isAdmin ? "cursor-pointer hover:text-primary/80 transition-colors" : ""}`}
                      onClick={startEditingTitle}
                      title={isAdmin ? "Clique para editar" : undefined}
                    >
                      {workspace.name}
                    </h1>
                  </div>
                )}
                {workspace.members && workspace.members.length > 0 && (
                  <TooltipProvider delayDuration={200}>
                    <div className="flex items-center mt-3">
                      <div className="flex -space-x-2">
                        {workspace.members.map((member: any) => (
                          <Tooltip key={member.userId ?? member.user?.id}>
                            <TooltipTrigger asChild>
                              <Avatar className="w-8 h-8 border-2 border-card ring-0 cursor-default">
                                {(member.user?.avatarUrl ?? member.avatarUrl) ? (
                                  <AvatarImage src={member.user?.avatarUrl ?? member.avatarUrl} alt={member.user?.name ?? member.name} />
                                ) : null}
                                <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">
                                  {getInitials(member.user?.name ?? member.name ?? "")}
                                </AvatarFallback>
                              </Avatar>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p className="font-medium">{member.user?.name ?? member.name}</p>
                              <p className="text-primary-foreground/70 text-[11px]">{translateRoleLabel(member.role)}</p>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                  </TooltipProvider>
                )}
              </div>
              <div className="flex gap-3">
                <Dialog open={isMapDialogOpen} onOpenChange={setIsMapDialogOpen}>
                  <DialogContent className="sm:max-w-md rounded-2xl">
                    <DialogHeader>
                      <DialogTitle className="text-2xl font-display lowercase">Criar Plano</DialogTitle>
                      <DialogDescription className="lowercase">Dê um nome para o seu novo plano de planejamento visual.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateMap} className="space-y-6 mt-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium lowercase">Nome do Plano</label>
                        <Input
                          placeholder="ex: Roadmap Q3, Sprint Planejamento"
                          value={mapName}
                          onChange={(e) => setMapName(e.target.value)}
                          className="h-12 rounded-xl"
                          autoFocus
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsMapDialogOpen(false)} className="rounded-xl lowercase">Cancelar</Button>
                        <Button type="submit" disabled={createMapMutation.isPending || !mapName.trim()} className="rounded-xl lowercase">
                          {createMapMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar Plano"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => { if (isValidTab(v)) setActiveTab(v); }} className="w-full">
              <TabsList className="bg-transparent border-b-0 h-auto p-0 flex gap-6 pb-px">
                <TabsTrigger value="maps" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary lowercase">
                  <Map className="w-5 h-5 mr-2" /> Planos
                </TabsTrigger>
                <TabsTrigger value="tasks" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary lowercase">
                  <CheckSquare className="w-5 h-5 mr-2" /> Tarefas
                </TabsTrigger>
                <TabsTrigger value="dashboard" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary lowercase">
                  <LayoutDashboard className="w-5 h-5 mr-2" /> Dashboard
                </TabsTrigger>
                <TabsTrigger value="members" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary lowercase">
                  <Users className="w-5 h-5 mr-2" /> Membros
                </TabsTrigger>
              </TabsList>

              <div className="pt-8 pb-16 max-w-6xl mx-auto">
                <TabsContent value="maps" className="mt-0 outline-none">
                  {isAdmin && (
                    <div className="flex items-center justify-between mb-6">
                      <p className="text-sm text-muted-foreground">
                        {maps?.length ?? 0} plano{(maps?.length ?? 0) !== 1 ? 's' : ''} {showHiddenMaps ? '(incluindo ocultos)' : ''}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl gap-2"
                        onClick={() => setShowHiddenMaps((v) => !v)}
                      >
                        {showHiddenMaps ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        <span className="lowercase">{showHiddenMaps ? "Ocultar ocultos" : "Ver ocultos"}</span>
                      </Button>
                    </div>
                  )}

                  {showHiddenMaps && isAdmin && (
                    <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-sm text-amber-700 dark:text-amber-400">
                      <EyeOff className="w-4 h-4 shrink-0" />
                      <span className="lowercase">Mostrando planos ocultos. Apenas administradores podem ver e restaurar planos ocultos.</span>
                    </div>
                  )}

                  {isMapsLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                  ) : maps?.length === 0 && showHiddenMaps ? (
                    <div className="text-center py-20 bg-background rounded-3xl border border-dashed border-border">
                      <Map className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                      <h3 className="text-xl font-bold font-display text-foreground lowercase">Nenhum plano oculto</h3>
                      <p className="text-muted-foreground mt-2 lowercase">Não há planos ocultos neste espaço.</p>
                    </div>
                  ) : maps?.length === 0 && !isAdmin ? (
                    <div className="text-center py-20 bg-background rounded-3xl border border-dashed border-border">
                      <Map className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                      <h3 className="text-xl font-bold font-display text-foreground lowercase">Nenhum plano criado</h3>
                      <p className="text-muted-foreground mt-2 lowercase">Comece a planejar visualmente com um plano.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {maps?.map(map => (
                        <MapCard
                          key={map.id}
                          map={map}
                          workspaceId={workspaceId}
                          isAdmin={isAdmin}
                        />
                      ))}
                      {isAdmin && !showHiddenMaps && (
                        <button
                          onClick={() => setIsMapDialogOpen(true)}
                          className="bg-card rounded-2xl p-6 border-2 border-dashed border-border/60 hover:border-primary/40 hover:shadow-md transition-all duration-300 cursor-pointer hover:-translate-y-1 flex flex-col items-center justify-center gap-3 min-h-[160px] text-muted-foreground hover:text-primary group"
                        >
                          <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                            <Plus className="w-6 h-6" />
                          </div>
                          <span className="text-sm font-semibold lowercase">Novo Plano</span>
                        </button>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="tasks" className="mt-0 outline-none">
                  {/* Header row: filters + nova tarefa button */}
                  <div className="flex flex-wrap items-center gap-3 mb-6">
                    <div className="flex flex-wrap items-center gap-2 flex-1">
                      <span className="text-xs font-semibold text-muted-foreground tracking-wider mr-1 lowercase">Status:</span>
                      {STATUS_OPTIONS.map(opt => {
                        const isActive = selectedStatuses.includes(opt.value);
                        const cnt = statusCounts?.[opt.value] ?? 0;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => toggleStatus(opt.value)}
                            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 cursor-pointer ${
                              isActive
                                ? opt.activeClass
                                : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
                            }`}
                          >
                            {cnt} {cnt > 1 ? opt.labelPlural : opt.label}
                          </button>
                        );
                      })}
                      {(workspaceMembers && workspaceMembers.length > 0) && (
                        <>
                          <span className="w-px h-4 bg-border mx-1" />
                          <span className="text-xs font-semibold text-muted-foreground tracking-wider mr-1 lowercase">Responsável:</span>
                          <AssigneeFilterPills
                            members={workspaceMembers.map(m => ({ userId: m.userId, name: m.user.name, avatarUrl: m.user.avatarUrl }))}
                            selected={selectedAssignees}
                            onToggle={toggleAssignee}
                          />
                        </>
                      )}
                      {(selectedStatuses.length > 0 || selectedAssignees.length > 0) && (
                        <button
                          onClick={clearAllFilters}
                          className="px-3 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all duration-150 cursor-pointer ml-1"
                        >
                          <span className="lowercase">Limpar filtros</span>
                        </button>
                      )}
                    </div>
                    <Button
                      className="rounded-xl h-9 px-4 shrink-0 lowercase"
                      onClick={() => { setEditingTaskId(null); setTaskSheetOpen(true); }}
                    >
                      <Plus className="w-4 h-4 mr-1.5" /> Nova Tarefa
                    </Button>
                  </div>

                  {isTasksLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    </div>
                  ) : workspaceTasks?.length === 0 ? (
                    <div className="text-center py-24 bg-card rounded-3xl border border-border shadow-sm">
                      <div className="w-20 h-20 bg-slate-100 dark:bg-slate-900 text-muted-foreground rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckSquare className="w-10 h-10" />
                      </div>
                      <h3 className="text-2xl font-bold font-display text-foreground lowercase">Nenhuma tarefa encontrada</h3>
                      <p className="text-muted-foreground mt-2 max-w-md mx-auto lowercase">Nenhuma tarefa neste espaço com estes filtros.</p>
                      <Button className="mt-6 rounded-xl lowercase" onClick={() => { setEditingTaskId(null); setTaskSheetOpen(true); }}>
                        <Plus className="w-4 h-4 mr-1.5" /> Nova Tarefa
                      </Button>
                    </div>
                  ) : (() => {
                    const today = new Date();
                    today.setHours(23, 59, 59, 999);
                    const todayTasks = (workspaceTasks ?? []).filter(task => {
                      if (task.dueDate) return new Date(task.dueDate) <= today;
                      return !!task.overdue;
                    });
                    const upcomingTasks = (workspaceTasks ?? []).filter(task => {
                      if (task.dueDate) return new Date(task.dueDate) > today;
                      return !task.overdue;
                    });

                    const detailMembers: TaskListItemMember[] = (workspaceMembers ?? []).map(m => ({
                      userId: m.userId,
                      name: m.user.name,
                    }));

                    return (
                      <div className="flex flex-col gap-6">
                        {todayTasks.length > 0 && (
                          <div>
                            <p className="text-xs font-light text-muted-foreground mb-2 px-1 lowercase">Pra hoje</p>
                            <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
                              <div className="divide-y divide-border/50">
                                {todayTasks.map(task => (
                                  <TaskListItem
                                    key={task.id}
                                    task={task}
                                    members={detailMembers}
                                    invalidateQueryKeys={[tasksQueryKey, countsQueryKey, ["/api/my-tasks"]]}
                                    countsQueryKeys={[countsQueryKey]}
                                    onOpenDetail={openTaskItem}
                                    showMapName
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        {upcomingTasks.length > 0 && (
                          <div>
                            <p className="text-xs font-light text-muted-foreground mb-2 px-1 lowercase">Próximas</p>
                            <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
                              <div className="divide-y divide-border/50">
                                {upcomingTasks.map(task => (
                                  <TaskListItem
                                    key={task.id}
                                    task={task}
                                    members={detailMembers}
                                    invalidateQueryKeys={[tasksQueryKey, countsQueryKey, ["/api/my-tasks"]]}
                                    countsQueryKeys={[countsQueryKey]}
                                    onOpenDetail={openTaskItem}
                                    showMapName
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </TabsContent>

                <TabsContent value="dashboard" className="mt-0 outline-none">
                  {dashboard ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium tracking-wider mb-2 lowercase">Total de Planos</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalMaps}</p>
                      </div>
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium tracking-wider mb-2 lowercase">Total de Cards</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalCards}</p>
                      </div>
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium tracking-wider mb-2 lowercase">Total de Tarefas</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalTasks}</p>
                      </div>

                      <div className="md:col-span-2 bg-card p-8 rounded-2xl border shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                          <BarChart3 className="w-5 h-5 text-primary" />
                          <h3 className="text-xl font-bold font-display lowercase">Tarefas por Status</h3>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          {[
                            { label: 'Pendente', value: dashboard.tasksByStatus.pending, bg: 'bg-slate-50 dark:bg-slate-900', border: 'border-slate-100 dark:border-slate-800', text: 'text-slate-500' },
                            { label: 'Em andamento', value: dashboard.tasksByStatus.in_progress, bg: 'bg-amber-50 dark:bg-amber-950/20', border: 'border-amber-100 dark:border-amber-900/50', text: 'text-amber-500' },
                            { label: 'Concluída', value: dashboard.tasksByStatus.completed, bg: 'bg-emerald-50 dark:bg-emerald-950/20', border: 'border-emerald-100 dark:border-emerald-900/50', text: 'text-emerald-500' },
                            { label: 'Atrasada', value: dashboard.tasksByStatus.overdue, bg: 'bg-red-50 dark:bg-red-950/20', border: 'border-red-100 dark:border-red-900/50', text: 'text-red-500' },
                          ].map(item => (
                            <div key={item.label} className={`p-4 rounded-xl ${item.bg} border ${item.border} text-center`}>
                              <p className={`text-3xl font-bold ${item.text} mb-1`}>{item.value}</p>
                              <p className={`text-sm font-medium ${item.text} tracking-wider lowercase`}>{item.label}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-card p-8 rounded-2xl border shadow-sm">
                        <h3 className="text-xl font-bold font-display mb-6 lowercase">Por Prioridade</h3>
                        <div className="space-y-4">
                          {[
                            { label: 'Máxima', value: dashboard.tasksByPriority.critical, color: 'bg-red-500' },
                            { label: 'Alta', value: dashboard.tasksByPriority.high, color: 'bg-orange-500' },
                            { label: 'Média', value: dashboard.tasksByPriority.medium, color: 'bg-blue-500' },
                            { label: 'Baixa', value: dashboard.tasksByPriority.low, color: 'bg-slate-400' },
                          ].map(item => (
                            <div key={item.label} className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${item.color}`} />
                                <span className="font-medium text-foreground lowercase">{item.label}</span>
                              </div>
                              <span className="text-muted-foreground font-bold">{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-10 text-center text-muted-foreground lowercase">Nenhum dado disponível ainda.</div>
                  )}
                </TabsContent>

                <TabsContent value="members" className="mt-0 outline-none">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {workspace.members.map(member => {
                      const isSelf = !!currentUserId && member.userId === currentUserId;
                      const canChangeRole = isAdmin && !!currentUserId && !isSelf;
                      return (
                        <div key={member.id} className="bg-card rounded-2xl p-6 border border-border/60 shadow-sm flex flex-col items-center gap-3 text-center">
                          <Avatar className="w-20 h-20 ring-2 ring-border shadow-sm">
                            {member.user.avatarUrl && <AvatarImage src={member.user.avatarUrl} alt={member.user.name} className="object-cover" />}
                            <AvatarFallback className="bg-primary/10 text-primary font-bold text-2xl">
                              {member.user.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="w-full min-w-0">
                            <p className="font-semibold text-foreground truncate">{member.user.name}</p>
                            <p className="text-sm text-muted-foreground truncate">{member.user.email}</p>
                          </div>
                          <div className="flex items-center justify-between w-full mt-auto pt-1">
                            {canChangeRole ? (
                              <Select
                                value={member.role}
                                onValueChange={(newRole) => {
                                  updateMemberRoleMutation.mutate({
                                    workspaceId,
                                    memberId: member.id,
                                    data: { role: newRole as "admin" | "editor" | "executor" },
                                  });
                                }}
                                disabled={updateMemberRoleMutation.isPending}
                              >
                                <SelectTrigger className="h-8 w-auto gap-1.5 px-2.5 rounded-full text-xs font-semibold border focus:ring-0 focus:ring-offset-0">
                                  <div className="flex items-center gap-1.5">
                                    {getRoleIcon(member.role)}
                                    <SelectValue />
                                  </div>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">
                                    <div className="flex items-center gap-2">
                                      <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                                      <span>Admin</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="editor">
                                    <div className="flex items-center gap-2">
                                      <Shield className="w-3.5 h-3.5 text-blue-500" />
                                      <span>Editor</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="executor">
                                    <div className="flex items-center gap-2">
                                      <User className="w-3.5 h-3.5 text-slate-500" />
                                      <span>Executor</span>
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wider lowercase ${getRoleBadgeClass(member.role)}`}>
                                {getRoleIcon(member.role)}
                                {translateRole(member.role)}
                              </span>
                            )}
                            {isAdmin && !isSelf && member.role !== 'admin' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                onClick={() => setRemovingMemberId(member.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {isAdmin && (
                      <button
                        onClick={() => setIsMemberDialogOpen(true)}
                        className="bg-card rounded-2xl p-6 border-2 border-dashed border-border/60 hover:border-primary/40 hover:shadow-md transition-all duration-300 cursor-pointer hover:-translate-y-1 flex flex-col items-center justify-center gap-3 min-h-[140px] text-muted-foreground hover:text-primary group"
                      >
                        <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center group-hover:bg-primary/10 transition-colors">
                          <UserPlus className="w-8 h-8" />
                        </div>
                        <span className="text-sm font-semibold lowercase">Adicionar Membro</span>
                      </button>
                    )}
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </div>

      {openCard && (
        <TaskDetailModal
          workspaceId={openCard.workspaceId}
          mapId={openCard.mapId}
          cardId={openCard.cardId}
          open={!!openCard}
          onClose={handleClosePanel}
          onDeleteCard={handleDeleteCardFromPanel}
        />
      )}

      <TaskDetailModal
        workspaceId={workspaceId}
        taskId={editingTaskId}
        open={taskSheetOpen}
        onClose={handleCloseTaskSheet}
      />

      {/* Add Member Dialog */}
      <Dialog open={isMemberDialogOpen} onOpenChange={(open) => {
        setIsMemberDialogOpen(open);
        if (!open) {
          setMemberEmail("");
          setMemberRole("editor");
          setSelectedSuggestions({});
        }
      }}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display lowercase">Convidar Membro</DialogTitle>
            <DialogDescription className="lowercase">Adicione membros pelo e-mail ou selecione da lista abaixo.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="flex flex-col gap-5 mt-2 min-h-0 flex-1">
            <div className="space-y-2">
              <label className="text-sm font-medium lowercase">E-mail do Usuário</label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="usuario@exemplo.com"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  className="h-10 rounded-xl flex-1"
                  autoFocus
                />
                <Select value={memberRole} onValueChange={(v) => setMemberRole(v as any)}>
                  <SelectTrigger className="h-10 w-[130px] rounded-xl text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="executor">Executor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {memberSuggestions && memberSuggestions.length > 0 && (
              <div className="space-y-2 min-h-0 flex flex-col">
                <label className="text-sm font-medium lowercase text-muted-foreground">Usuários dos seus espaços</label>
                <div className="overflow-y-auto max-h-[240px] border border-border rounded-xl divide-y divide-border/50">
                  {memberSuggestions.map((s) => {
                    const isSelected = s.userId in selectedSuggestions;
                    return (
                      <div
                        key={s.userId}
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                          isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                        }`}
                        onClick={() => {
                          setSelectedSuggestions((prev) => {
                            if (isSelected) {
                              const next = { ...prev };
                              delete next[s.userId];
                              return next;
                            }
                            return { ...prev, [s.userId]: "editor" };
                          });
                        }}
                      >
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isSelected ? "bg-primary border-primary text-primary-foreground" : "border-border"
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                        </div>
                        <Avatar className="w-8 h-8 ring-1 ring-border shrink-0">
                          {s.avatarUrl && <AvatarImage src={s.avatarUrl} alt={s.name} />}
                          <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">
                            {getInitials(s.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{s.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                        </div>
                        {isSelected && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <Select
                              value={selectedSuggestions[s.userId]}
                              onValueChange={(v) => {
                                setSelectedSuggestions((prev) => ({
                                  ...prev,
                                  [s.userId]: v as "admin" | "editor" | "executor",
                                }));
                              }}
                            >
                              <SelectTrigger className="h-7 w-[100px] rounded-lg text-[11px] border-border/60">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="editor">Editor</SelectItem>
                                <SelectItem value="executor">Executor</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsMemberDialogOpen(false)} className="rounded-xl lowercase">Cancelar</Button>
              <Button
                type="submit"
                disabled={isInviting || (!memberEmail.trim() && Object.keys(selectedSuggestions).length === 0)}
                className="rounded-xl lowercase"
              >
                {isInviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserPlus className="w-4 h-4 mr-2" />Convidar</>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation */}
      <AlertDialog open={!!removingMemberId} onOpenChange={(open) => !open && setRemovingMemberId(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="lowercase">Remover membro?</AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              Este usuário perderá acesso ao workspace e a todos os seus planos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl lowercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removingMemberId && removeMemberMutation.mutate({ workspaceId, memberId: removingMemberId })}
            >
              {removeMemberMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="lowercase">Remover</span>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
