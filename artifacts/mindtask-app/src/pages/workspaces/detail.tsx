import { useState } from "react";
import { useRoute, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetWorkspace, useCreateMap, useGetDashboard, useAddWorkspaceMember, useRemoveWorkspaceMember, useListWorkspaceMembers, customFetch } from "@workspace/api-client-react";
import { useListMapsWithHidden, useToggleMapHidden } from "@/hooks/useHidden";
import { Map, Plus, Users, Settings, LayoutDashboard, Loader2, ArrowRight, BarChart3, UserPlus, Trash2, ShieldAlert, Shield, User, EyeOff, Eye, CheckSquare, Flag, Calendar as CalendarIcon, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { CardPanel } from "@/components/maps/CardPanel";
import { WorkspaceTaskSheet } from "@/components/tasks/WorkspaceTaskSheet";
import { AssigneeFilterPills } from "@/components/tasks/AssigneeFilterPills";

function MapCard({ map, workspaceId, isAdmin }: {
  map: { id: string; name: string; hidden: boolean; updatedAt: string };
  workspaceId: string;
  isAdmin: boolean;
}) {
  const toggleHidden = useToggleMapHidden(workspaceId, map.id);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleHidden.mutate(!map.hidden);
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
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                <EyeOff className="w-3 h-3" /> Oculto
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">Atualizado em {format(new Date(map.updatedAt), 'dd/MM/yyyy')}</p>
          <div className="mt-6 flex justify-end">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-foreground group-hover/card:bg-primary group-hover/card:text-primary-foreground transition-colors">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </Link>

      {isAdmin && (
        <button
          onClick={handleToggle}
          disabled={toggleHidden.isPending}
          title={map.hidden ? "Tornar visível" : "Ocultar mapa"}
          className="absolute top-3 right-3 w-8 h-8 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-background border border-border shadow-sm hover:border-slate-400 dark:hover:border-slate-500 text-muted-foreground hover:text-foreground z-10"
        >
          {toggleHidden.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : map.hidden ? (
            <Eye className="w-3.5 h-3.5" />
          ) : (
            <EyeOff className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

export default function WorkspaceDetailPage() {
  const [, params] = useRoute("/workspaces/:id");
  const workspaceId = params?.id || "";

  const { data: workspace, isLoading: isWsLoading } = useGetWorkspace(workspaceId);
  const { data: dashboard } = useGetDashboard(workspaceId);

  const [isMapDialogOpen, setIsMapDialogOpen] = useState(false);
  const [mapName, setMapName] = useState("");
  const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"admin" | "editor" | "executor">("editor");
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [showHiddenMaps, setShowHiddenMaps] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["in_progress", "pending"]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [openCard, setOpenCard] = useState<{ workspaceId: string; mapId: string; cardId: string } | null>(null);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

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

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createMapMutation = useCreateMap({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps`] });
        setIsMapDialogOpen(false);
        setMapName("");
        toast({ title: "Mapa criado com sucesso!" });
      }
    }
  });

  const addMemberMutation = useAddWorkspaceMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}`] });
        setIsMemberDialogOpen(false);
        setMemberEmail("");
        setMemberRole("editor");
        toast({ title: "Membro adicionado com sucesso!" });
      },
      onError: (err: any) => {
        toast({
          title: "Falha ao adicionar membro",
          description: err?.data?.message || "Verifique se o e-mail está correto e o usuário está cadastrado.",
          variant: "destructive"
        });
      }
    }
  });

  const removeMemberMutation = useRemoveWorkspaceMember({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}`] });
        setRemovingMemberId(null);
        toast({ title: "Membro removido." });
      }
    }
  });

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

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberEmail.trim()) return;
    addMemberMutation.mutate({ workspaceId, data: { email: memberEmail, role: memberRole } });
  };

  const isAdmin = workspace?.role === "admin";

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
    { value: "in_progress", label: "Em andamento", activeClass: "bg-amber-500 text-white border-amber-500 hover:bg-amber-600" },
    { value: "pending",     label: "Pendente",      activeClass: "bg-blue-500 text-white border-blue-500 hover:bg-blue-600" },
    { value: "blocked",     label: "Interrompida",  activeClass: "bg-purple-500 text-white border-purple-500 hover:bg-purple-600" },
    { value: "completed",   label: "Concluída",     activeClass: "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600" },
  ];

  const toggleStatus = (value: string) => {
    setSelectedStatuses(prev =>
      prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]
    );
  };

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'critical': return 'text-red-500 bg-red-500/10 border-red-200 dark:border-red-900/50';
      case 'high': return 'text-orange-500 bg-orange-500/10 border-orange-200 dark:border-orange-900/50';
      case 'medium': return 'text-blue-500 bg-blue-500/10 border-blue-200 dark:border-blue-900/50';
      case 'low': return 'text-slate-500 bg-slate-500/10 border-slate-200 dark:border-slate-800';
      default: return '';
    }
  };

  const translatePriority = (p: string) => {
    switch (p) {
      case 'critical': return 'Crítica';
      case 'high': return 'Alta';
      case 'medium': return 'Média';
      case 'low': return 'Baixa';
      default: return p;
    }
  };

  const getStatusLabel = (s: string) => {
    switch (s) {
      case 'pending': return 'PENDENTE';
      case 'in_progress': return 'EM ANDAMENTO';
      case 'completed': return 'CONCLUÍDA';
      case 'overdue': return 'VENCIDA';
      case 'blocked': return 'INTERROMPIDA';
      default: return s.replace('_', ' ').toUpperCase();
    }
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'overdue': return 'bg-red-500 text-white border-transparent';
      case 'completed': return 'bg-emerald-500 text-white border-transparent';
      case 'in_progress': return 'bg-amber-500 text-white border-transparent';
      case 'pending': return 'bg-blue-500 text-white border-transparent';
      case 'blocked': return 'bg-purple-500 text-white border-transparent';
      default: return '';
    }
  };

  const handleClosePanel = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: tasksQueryKey });
    setOpenCard(null);
  };

  const handleCloseTaskSheet = () => {
    queryClient.invalidateQueries({ queryKey: tasksQueryKey });
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
              <Link href="/workspaces"><span className="hover:text-foreground cursor-pointer transition-colors">Espaços de Trabalho</span></Link>
              <span>/</span>
              <span className="text-foreground font-medium">{workspace.name}</span>
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8">
              <div>
                <h1 className="text-4xl font-display font-bold text-foreground">{workspace.name}</h1>
                <p className="text-muted-foreground mt-2 text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  {workspace.members.length} membro{workspace.members.length !== 1 ? 's' : ''} · Papel: <span className="font-medium">{translateRole(workspace.role)}</span>
                </p>
              </div>
              <div className="flex gap-3">
                {isAdmin && (
                  <Button variant="outline" className="rounded-xl h-11 px-5" onClick={() => setIsMemberDialogOpen(true)}>
                    <UserPlus className="w-4 h-4 mr-2" /> Convidar
                  </Button>
                )}
                <Dialog open={isMapDialogOpen} onOpenChange={setIsMapDialogOpen}>
                  <Button className="rounded-xl h-11 px-5 shadow-lg shadow-primary/20" onClick={() => setIsMapDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" /> Novo Mapa
                  </Button>
                  <DialogContent className="sm:max-w-md rounded-2xl">
                    <DialogHeader>
                      <DialogTitle className="text-2xl font-display">Criar Mapa Mental</DialogTitle>
                      <DialogDescription>Dê um nome para o seu novo mapa de planejamento visual.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateMap} className="space-y-6 mt-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Nome do Mapa</label>
                        <Input
                          placeholder="ex: Roadmap Q3, Sprint Planejamento"
                          value={mapName}
                          onChange={(e) => setMapName(e.target.value)}
                          className="h-12 rounded-xl"
                          autoFocus
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsMapDialogOpen(false)} className="rounded-xl">Cancelar</Button>
                        <Button type="submit" disabled={createMapMutation.isPending || !mapName.trim()} className="rounded-xl">
                          {createMapMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar Mapa"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            <Tabs defaultValue="maps" className="w-full">
              <TabsList className="bg-transparent border-b-0 h-auto p-0 flex gap-6 pb-px">
                <TabsTrigger value="maps" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <Map className="w-5 h-5 mr-2" /> Mapas Mentais
                </TabsTrigger>
                <TabsTrigger value="tasks" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <CheckSquare className="w-5 h-5 mr-2" /> Tarefas
                </TabsTrigger>
                <TabsTrigger value="dashboard" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <LayoutDashboard className="w-5 h-5 mr-2" /> Dashboard
                </TabsTrigger>
                <TabsTrigger value="members" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <Users className="w-5 h-5 mr-2" /> Membros
                </TabsTrigger>
              </TabsList>

              <div className="pt-8 pb-16 max-w-6xl mx-auto">
                <TabsContent value="maps" className="mt-0 outline-none">
                  {isAdmin && (
                    <div className="flex items-center justify-between mb-6">
                      <p className="text-sm text-muted-foreground">
                        {maps?.length ?? 0} mapa{(maps?.length ?? 0) !== 1 ? 's' : ''} {showHiddenMaps ? '(incluindo ocultos)' : ''}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl gap-2"
                        onClick={() => setShowHiddenMaps((v) => !v)}
                      >
                        {showHiddenMaps ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        {showHiddenMaps ? "Ocultar ocultos" : "Ver ocultos"}
                      </Button>
                    </div>
                  )}

                  {showHiddenMaps && isAdmin && (
                    <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-sm text-amber-700 dark:text-amber-400">
                      <EyeOff className="w-4 h-4 shrink-0" />
                      <span>Mostrando mapas ocultos. Apenas administradores podem ver e restaurar mapas ocultos.</span>
                    </div>
                  )}

                  {isMapsLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                  ) : maps?.length === 0 ? (
                    <div className="text-center py-20 bg-background rounded-3xl border border-dashed border-border">
                      <Map className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                      <h3 className="text-xl font-bold font-display text-foreground">
                        {showHiddenMaps ? "Nenhum mapa oculto" : "Nenhum mapa criado"}
                      </h3>
                      <p className="text-muted-foreground mt-2 mb-6">
                        {showHiddenMaps ? "Não há mapas ocultos neste espaço." : "Comece a planejar visualmente com um mapa mental."}
                      </p>
                      {!showHiddenMaps && (
                        <Button onClick={() => setIsMapDialogOpen(true)} className="rounded-xl">Criar primeiro mapa</Button>
                      )}
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
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="tasks" className="mt-0 outline-none">
                  {/* Header row: filters + nova tarefa button */}
                  <div className="flex flex-wrap items-center gap-3 mb-6">
                    <div className="flex flex-wrap items-center gap-2 flex-1">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">Status:</span>
                      {STATUS_OPTIONS.map(opt => {
                        const isActive = selectedStatuses.includes(opt.value);
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
                            {opt.label}
                          </button>
                        );
                      })}
                      {(workspaceMembers && workspaceMembers.length > 0) && (
                        <>
                          <span className="w-px h-4 bg-border mx-1" />
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">Responsável:</span>
                          <AssigneeFilterPills
                            members={workspaceMembers.map(m => ({ userId: m.userId, name: m.user.name }))}
                            selected={selectedAssignees}
                            onToggle={toggleAssignee}
                            onClear={() => setSelectedAssignees([])}
                          />
                        </>
                      )}
                      {(selectedStatuses.length > 0 || selectedAssignees.length > 0) && (
                        <button
                          onClick={clearAllFilters}
                          className="px-3 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all duration-150 cursor-pointer ml-1"
                        >
                          Limpar filtros
                        </button>
                      )}
                    </div>
                    <Button
                      className="rounded-xl h-9 px-4 shrink-0"
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
                      <h3 className="text-2xl font-bold font-display text-foreground">Nenhuma tarefa encontrada</h3>
                      <p className="text-muted-foreground mt-2 max-w-md mx-auto">Nenhuma tarefa neste espaço com estes filtros.</p>
                      <Button className="mt-6 rounded-xl" onClick={() => { setEditingTaskId(null); setTaskSheetOpen(true); }}>
                        <Plus className="w-4 h-4 mr-1.5" /> Nova Tarefa
                      </Button>
                    </div>
                  ) : (
                    <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
                      <div className="divide-y divide-border/50">
                        {workspaceTasks?.map(task => {
                          const isOverdue = !!task.overdue && task.status !== 'completed' && task.status !== 'blocked';
                          const visualStatus = isOverdue ? 'overdue' : task.status;
                          const isStandalone = !task.mapId;
                          return (
                            <div
                              key={task.id}
                              className="p-6 transition-colors flex flex-col md:flex-row gap-6 md:items-center justify-between group cursor-pointer"
                              style={{
                                backgroundColor: isOverdue ? 'rgba(254, 202, 202, 0.55)' : undefined,
                              }}
                              onMouseEnter={e => { if (isOverdue) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(254, 202, 202, 0.75)'; else (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgb(248 250 252)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isOverdue ? 'rgba(254, 202, 202, 0.55)' : ''; }}
                              onClick={() => openTaskItem(task)}
                            >
                              <div className="flex-1 min-w-0">
                                <h3 className="text-xl font-bold text-foreground mb-1">{task.cardTitle || task.title}</h3>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                                  <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-semibold no-default-active-elevate ${getStatusColor(visualStatus)}`}>
                                    {getStatusLabel(visualStatus)}
                                  </Badge>
                                  <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${getPriorityColor(task.priority)}`}>
                                    <Flag className="w-3 h-3 mr-1 inline-block" /> {translatePriority(task.priority)}
                                  </Badge>
                                  {isStandalone && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full uppercase tracking-wide">
                                      Avulsa
                                    </span>
                                  )}
                                  {task.mapName && (
                                    <div className="flex items-center gap-1.5">
                                      <Map className="w-3.5 h-3.5 shrink-0" />
                                      <span className="truncate max-w-[180px]">{task.mapName}</span>
                                    </div>
                                  )}
                                  {task.dueDate && (
                                    <div className="flex items-center gap-1.5">
                                      <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                                      <span>{format(new Date(task.dueDate), "dd/MM/yyyy")}</span>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1.5">
                                    <User className="w-3.5 h-3.5 shrink-0" />
                                    <span>{task.assigneeName ?? "Sem responsável"}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-lg bg-background shadow-sm hover:border-primary hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                                  onClick={(e) => { e.stopPropagation(); openTaskItem(task); }}
                                >
                                  <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
                                </Button>
                                {!isStandalone && (
                                  <Link href={`/workspaces/${task.workspaceId}/maps/${task.mapId}`}>
                                    <Button variant="ghost" size="sm" className="rounded-lg text-muted-foreground hover:text-primary transition-colors text-xs px-2 h-7">
                                      Ver no Mapa <ArrowRight className="w-3 h-3 ml-1" />
                                    </Button>
                                  </Link>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="dashboard" className="mt-0 outline-none">
                  {dashboard ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Total de Mapas</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalMaps}</p>
                      </div>
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Total de Cards</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalCards}</p>
                      </div>
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Total de Tarefas</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalTasks}</p>
                      </div>

                      <div className="md:col-span-2 bg-card p-8 rounded-2xl border shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                          <BarChart3 className="w-5 h-5 text-primary" />
                          <h3 className="text-xl font-bold font-display">Tarefas por Status</h3>
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
                              <p className={`text-sm font-medium ${item.text} uppercase tracking-wider`}>{item.label}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-card p-8 rounded-2xl border shadow-sm">
                        <h3 className="text-xl font-bold font-display mb-6">Por Prioridade</h3>
                        <div className="space-y-4">
                          {[
                            { label: 'Crítica', value: dashboard.tasksByPriority.critical, color: 'bg-red-500' },
                            { label: 'Alta', value: dashboard.tasksByPriority.high, color: 'bg-orange-500' },
                            { label: 'Média', value: dashboard.tasksByPriority.medium, color: 'bg-blue-500' },
                            { label: 'Baixa', value: dashboard.tasksByPriority.low, color: 'bg-slate-400' },
                          ].map(item => (
                            <div key={item.label} className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${item.color}`} />
                                <span className="font-medium text-foreground">{item.label}</span>
                              </div>
                              <span className="text-muted-foreground font-bold">{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-10 text-center text-muted-foreground">Nenhum dado disponível ainda.</div>
                  )}
                </TabsContent>

                <TabsContent value="members" className="mt-0 outline-none">
                  <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-border flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                      <h3 className="text-lg font-bold font-display">Membros do Workspace</h3>
                      {isAdmin && (
                        <Button size="sm" className="rounded-lg" onClick={() => setIsMemberDialogOpen(true)}>
                          <UserPlus className="w-4 h-4 mr-2" /> Adicionar Membro
                        </Button>
                      )}
                    </div>
                    <div className="divide-y divide-border">
                      {workspace.members.map(member => (
                        <div key={member.id} className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                              {member.user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{member.user.name}</p>
                              <p className="text-sm text-muted-foreground">{member.user.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${getRoleBadgeClass(member.role)}`}>
                              {getRoleIcon(member.role)}
                              {translateRole(member.role)}
                            </span>
                            {isAdmin && member.role !== 'admin' && (
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
                      ))}
                    </div>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </div>

      {openCard && (
        <CardPanel
          workspaceId={openCard.workspaceId}
          mapId={openCard.mapId}
          cardId={openCard.cardId}
          onClose={handleClosePanel}
        />
      )}

      <WorkspaceTaskSheet
        workspaceId={workspaceId}
        taskId={editingTaskId}
        open={taskSheetOpen}
        onClose={handleCloseTaskSheet}
      />

      {/* Add Member Dialog */}
      <Dialog open={isMemberDialogOpen} onOpenChange={setIsMemberDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display">Convidar Membro</DialogTitle>
            <DialogDescription>Adicione um usuário cadastrado pelo e-mail e defina seu papel no workspace.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-5 mt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">E-mail do Usuário</label>
              <Input
                type="email"
                placeholder="usuario@exemplo.com"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                className="h-12 rounded-xl"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Papel no Workspace</label>
              <Select value={memberRole} onValueChange={(v) => setMemberRole(v as any)}>
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-red-500" />
                      <div>
                        <p className="font-medium">Admin</p>
                        <p className="text-xs text-muted-foreground">Gerencia membros, mapas e tarefas</p>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="editor">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-500" />
                      <div>
                        <p className="font-medium">Editor</p>
                        <p className="text-xs text-muted-foreground">Cria e edita mapas e tarefas</p>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="executor">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-slate-500" />
                      <div>
                        <p className="font-medium">Executor</p>
                        <p className="text-xs text-muted-foreground">Atualiza status das próprias tarefas</p>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsMemberDialogOpen(false)} className="rounded-xl">Cancelar</Button>
              <Button type="submit" disabled={addMemberMutation.isPending || !memberEmail.trim()} className="rounded-xl">
                {addMemberMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserPlus className="w-4 h-4 mr-2" />Convidar</>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation */}
      <AlertDialog open={!!removingMemberId} onOpenChange={(open) => !open && setRemovingMemberId(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              Este usuário perderá acesso ao workspace e a todos os seus mapas. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => removingMemberId && removeMemberMutation.mutate({ workspaceId, memberId: removingMemberId })}
            >
              {removeMemberMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
