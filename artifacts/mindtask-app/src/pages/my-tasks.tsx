import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetMyTasks } from "@workspace/api-client-react";
import { CheckSquare, Loader2, Flag, Calendar as CalendarIcon, Map as MapIcon, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function MyTasksPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const { data: tasks, isLoading } = useGetMyTasks({ 
    status: statusFilter !== "all" ? statusFilter as any : undefined 
  });

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'critical': return 'text-red-500 bg-red-500/10 border-red-200 dark:border-red-900/50';
      case 'high': return 'text-orange-500 bg-orange-500/10 border-orange-200 dark:border-orange-900/50';
      case 'medium': return 'text-blue-500 bg-blue-500/10 border-blue-200 dark:border-blue-900/50';
      case 'low': return 'text-slate-500 bg-slate-500/10 border-slate-200 dark:border-slate-800';
      default: return '';
    }
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'overdue': return 'bg-red-500 text-white border-transparent';
      case 'completed': return 'bg-emerald-500 text-white border-transparent';
      case 'in_progress': return 'bg-amber-500 text-white border-transparent';
      case 'pending': return 'bg-blue-500 text-white border-transparent';
      default: return '';
    }
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-6xl mx-auto p-8 lg:p-12">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-12">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
                  <CheckSquare className="w-5 h-5" />
                </div>
                <h1 className="text-4xl font-display font-bold text-foreground">My Tasks</h1>
              </div>
              <p className="text-muted-foreground text-lg ml-1">Everything assigned to you across all workspaces.</p>
            </div>
            
            <div className="w-full sm:w-48">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Filter by Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-12 rounded-xl bg-card border-border/60 shadow-sm">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
          ) : tasks?.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-3xl border border-border shadow-sm">
              <div className="w-20 h-20 bg-slate-100 dark:bg-slate-900 text-muted-foreground rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckSquare className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold font-display text-foreground">You're all caught up!</h3>
              <p className="text-muted-foreground mt-2 max-w-md mx-auto">You have no assigned tasks matching these filters.</p>
            </div>
          ) : (
            <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
              <div className="divide-y divide-border/50">
                {tasks?.map(task => (
                  <div key={task.id} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors flex flex-col md:flex-row gap-6 md:items-center justify-between group">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-semibold no-default-active-elevate ${getStatusColor(task.status)}`}>
                          {task.status.replace('_', ' ').toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${getPriorityColor(task.priority)}`}>
                          <Flag className="w-3 h-3 mr-1 inline-block" /> {task.priority}
                        </Badge>
                      </div>
                      <h3 className="text-xl font-bold text-foreground mb-1">{task.title}</h3>
                      <p className="text-muted-foreground text-sm line-clamp-1 max-w-2xl">{task.description || "No description provided."}</p>
                    </div>

                    <div className="flex flex-col md:items-end gap-3 shrink-0">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {task.dueDate && (
                          <div className="flex items-center gap-1.5">
                            <CalendarIcon className="w-4 h-4" />
                            <span>{format(new Date(task.dueDate), 'MMM d')}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <MapIcon className="w-4 h-4" />
                          <span className="truncate max-w-[120px]" title={`${task.workspaceName} > ${task.mapName}`}>
                            {task.mapName}
                          </span>
                        </div>
                      </div>
                      
                      <Link href={`/workspaces/${task.workspaceId}/maps/${task.mapId}`}>
                        <Button variant="outline" size="sm" className="rounded-lg bg-background shadow-sm hover:border-primary hover:text-primary transition-colors">
                          View in Map <ArrowRight className="w-4 h-4 ml-1.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
