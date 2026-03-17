import { useState } from "react";
import { useRoute, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetWorkspace, useListMaps, useCreateMap, useGetDashboard, useAddWorkspaceMember, useRemoveWorkspaceMember } from "@workspace/api-client-react";
import { Map, Plus, Users, Settings, LayoutDashboard, Loader2, ArrowRight, BarChart3, UserPlus, Trash2, ShieldAlert, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function WorkspaceDetailPage() {
  const [, params] = useRoute("/workspaces/:id");
  const workspaceId = params?.id || "";

  const { data: workspace, isLoading: isWsLoading } = useGetWorkspace(workspaceId);
  const { data: maps, isLoading: isMapsLoading } = useListMaps(workspaceId);
  const { data: dashboard } = useGetDashboard(workspaceId);

  const [isMapDialogOpen, setIsMapDialogOpen] = useState(false);
  const [mapName, setMapName] = useState("");
  const [isMemberDialogOpen, setIsMemberDialogOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"admin" | "editor" | "executor">("editor");
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

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
              <Link href="/workspaces"><span className="hover:text-foreground cursor-pointer transition-colors">Workspaces</span></Link>
              <span>/</span>
              <span className="text-foreground font-medium">{workspace.name}</span>
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8">
              <div>
                <h1 className="text-4xl font-display font-bold text-foreground">{workspace.name}</h1>
                <p className="text-muted-foreground mt-2 text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  {workspace.members.length} membro{workspace.members.length !== 1 ? 's' : ''} · Papel: <span className="capitalize font-medium">{workspace.role}</span>
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
                <TabsTrigger value="dashboard" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <LayoutDashboard className="w-5 h-5 mr-2" /> Dashboard
                </TabsTrigger>
                <TabsTrigger value="members" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <Users className="w-5 h-5 mr-2" /> Membros
                </TabsTrigger>
              </TabsList>

              <div className="pt-8 pb-16 max-w-6xl mx-auto">
                <TabsContent value="maps" className="mt-0 outline-none">
                  {isMapsLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                  ) : maps?.length === 0 ? (
                    <div className="text-center py-20 bg-background rounded-3xl border border-dashed border-border">
                      <Map className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                      <h3 className="text-xl font-bold font-display text-foreground">Nenhum mapa criado</h3>
                      <p className="text-muted-foreground mt-2 mb-6">Comece a planejar visualmente com um mapa mental.</p>
                      <Button onClick={() => setIsMapDialogOpen(true)} className="rounded-xl">Criar primeiro mapa</Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {maps?.map(map => (
                        <Link key={map.id} href={`/workspaces/${workspaceId}/maps/${map.id}`}>
                          <div className="group bg-card rounded-2xl p-6 border border-border/60 shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300 cursor-pointer hover:-translate-y-1">
                            <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                              <Map className="w-6 h-6" />
                            </div>
                            <h3 className="text-lg font-bold font-display text-foreground group-hover:text-primary transition-colors">{map.name}</h3>
                            <p className="text-sm text-muted-foreground mt-2">Atualizado em {format(new Date(map.updatedAt), 'dd/MM/yyyy')}</p>
                            <div className="mt-6 flex justify-end">
                              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                <ArrowRight className="w-4 h-4" />
                              </div>
                            </div>
                          </div>
                        </Link>
                      ))}
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
                              {member.role}
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
