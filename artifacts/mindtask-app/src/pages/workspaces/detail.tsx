import { useState } from "react";
import { useRoute, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetWorkspace, useListMaps, useCreateMap, useGetDashboard } from "@workspace/api-client-react";
import { Map, Plus, Users, Settings, LayoutDashboard, Loader2, ArrowRight, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createMapMutation = useCreateMap({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps`] });
        setIsMapDialogOpen(false);
        setMapName("");
        toast({ title: "Map created successfully!" });
      }
    }
  });

  const handleCreateMap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapName.trim()) return;
    createMapMutation.mutate({ workspaceId, data: { name: mapName } });
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
        {/* Header */}
        <div className="bg-card border-b border-border pt-12 px-8 lg:px-12 pb-0">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 text-muted-foreground mb-4 text-sm">
              <Link href="/workspaces"><span className="hover:text-foreground cursor-pointer">Workspaces</span></Link>
              <span>/</span>
              <span className="text-foreground font-medium">{workspace.name}</span>
            </div>
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8">
              <div>
                <h1 className="text-4xl font-display font-bold text-foreground">{workspace.name}</h1>
                <p className="text-muted-foreground mt-2 text-lg flex items-center gap-2">
                  <Users className="w-5 h-5" /> 
                  {workspace.members.length} member{workspace.members.length !== 1 ? 's' : ''} • Role: {workspace.role}
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="rounded-xl h-11 px-5">
                  <Settings className="w-4 h-4 mr-2" /> Settings
                </Button>
                <Dialog open={isMapDialogOpen} onOpenChange={setIsMapDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="rounded-xl h-11 px-5 shadow-lg shadow-primary/20">
                      <Plus className="w-4 h-4 mr-2" /> New Map
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md rounded-2xl">
                    <DialogHeader>
                      <DialogTitle className="text-2xl font-display">Create Mind Map</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleCreateMap} className="space-y-6 mt-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Map Name</label>
                        <Input 
                          placeholder="e.g. Q3 Product Roadmap" 
                          value={mapName}
                          onChange={(e) => setMapName(e.target.value)}
                          className="h-12 rounded-xl"
                          autoFocus
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsMapDialogOpen(false)} className="rounded-xl">
                          Cancel
                        </Button>
                        <Button type="submit" disabled={createMapMutation.isPending || !mapName.trim()} className="rounded-xl">
                          {createMapMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Map"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* Tabs Trigger */}
            <Tabs defaultValue="maps" className="w-full">
              <TabsList className="bg-transparent border-b-0 h-auto p-0 flex gap-6 pb-px">
                <TabsTrigger value="maps" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <Map className="w-5 h-5 mr-2" /> Mind Maps
                </TabsTrigger>
                <TabsTrigger value="dashboard" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <LayoutDashboard className="w-5 h-5 mr-2" /> Dashboard
                </TabsTrigger>
                <TabsTrigger value="members" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 pt-2 text-base font-medium text-muted-foreground data-[state=active]:text-primary">
                  <Users className="w-5 h-5 mr-2" /> Members
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
                      <h3 className="text-xl font-bold font-display text-foreground">No maps created yet</h3>
                      <p className="text-muted-foreground mt-2 mb-6">Start planning visually by creating a new mind map.</p>
                      <Button onClick={() => setIsMapDialogOpen(true)} className="rounded-xl">Create your first map</Button>
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
                            <p className="text-sm text-muted-foreground mt-2">Updated {format(new Date(map.updatedAt), 'MMM d, yyyy')}</p>
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
                      {/* Summary Cards */}
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Total Maps</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalMaps}</p>
                      </div>
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Total Cards</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalCards}</p>
                      </div>
                      <div className="bg-card p-6 rounded-2xl border shadow-sm">
                        <p className="text-muted-foreground text-sm font-medium uppercase tracking-wider mb-2">Total Tasks</p>
                        <p className="text-4xl font-display font-bold text-foreground">{dashboard.totalTasks}</p>
                      </div>

                      {/* Status Breakdown */}
                      <div className="md:col-span-2 bg-card p-8 rounded-2xl border shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                          <BarChart3 className="w-5 h-5 text-primary" />
                          <h3 className="text-xl font-bold font-display">Tasks by Status</h3>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-center">
                            <p className="text-3xl font-bold text-slate-500 mb-1">{dashboard.tasksByStatus.pending}</p>
                            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Pending</p>
                          </div>
                          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/50 text-center">
                            <p className="text-3xl font-bold text-amber-500 mb-1">{dashboard.tasksByStatus.in_progress}</p>
                            <p className="text-sm font-medium text-amber-600 uppercase tracking-wider">In Progress</p>
                          </div>
                          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 text-center">
                            <p className="text-3xl font-bold text-emerald-500 mb-1">{dashboard.tasksByStatus.completed}</p>
                            <p className="text-sm font-medium text-emerald-600 uppercase tracking-wider">Completed</p>
                          </div>
                          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 text-center">
                            <p className="text-3xl font-bold text-red-500 mb-1">{dashboard.tasksByStatus.overdue}</p>
                            <p className="text-sm font-medium text-red-600 uppercase tracking-wider">Overdue</p>
                          </div>
                        </div>
                      </div>

                      {/* Priority Breakdown */}
                      <div className="bg-card p-8 rounded-2xl border shadow-sm">
                        <h3 className="text-xl font-bold font-display mb-6">By Priority</h3>
                        <div className="space-y-4">
                          {[
                            { label: 'Critical', value: dashboard.tasksByPriority.critical, color: 'bg-red-500' },
                            { label: 'High', value: dashboard.tasksByPriority.high, color: 'bg-orange-500' },
                            { label: 'Medium', value: dashboard.tasksByPriority.medium, color: 'bg-blue-500' },
                            { label: 'Low', value: dashboard.tasksByPriority.low, color: 'bg-slate-400' },
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
                    <div className="py-10 text-center text-muted-foreground">No dashboard data available</div>
                  )}
                </TabsContent>

                <TabsContent value="members" className="mt-0 outline-none">
                  <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-border flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                      <h3 className="text-lg font-bold font-display">Workspace Members</h3>
                      <Button size="sm" className="rounded-lg">Add Member</Button>
                    </div>
                    <div className="divide-y divide-border">
                      {workspace.members.map(member => (
                        <div key={member.id} className="p-4 px-6 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                              {member.user.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{member.user.name}</p>
                              <p className="text-sm text-muted-foreground">{member.user.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                              {member.role}
                            </span>
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
    </AppLayout>
  );
}
