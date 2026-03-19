import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout, useListWorkspaces } from "@workspace/api-client-react";
import { LogOut, CheckSquare, Compass, Folders, Loader2, Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQueryClient } from "@tanstack/react-query";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar_collapsed") === "true"; } catch { return false; }
  });

  const { data: user, isLoading: isUserLoading } = useGetMe({
    query: { retry: false }
  });
  
  const { data: workspaces, isLoading: isWorkspacesLoading } = useListWorkspaces({
    query: { enabled: !!user }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        localStorage.removeItem("mindtask_token");
        window.location.href = "/login";
      }
    }
  });

  useEffect(() => {
    if (!isUserLoading && !user) {
      setLocation("/login");
    }
  }, [isUserLoading, user, setLocation]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("sidebar_collapsed", String(next)); } catch {}
      return next;
    });
  };

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const isActive = (path: string) => location.startsWith(path);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={`bg-sidebar text-sidebar-foreground flex flex-col shadow-xl z-20 shrink-0 transition-all duration-300 ease-in-out ${collapsed ? 'w-16' : 'w-72'}`}
      >
        {/* Logo + toggle */}
        <div className="flex items-center gap-3 p-4 pr-3 border-b border-sidebar-border/50 min-h-[65px]">
          {!collapsed && (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
                <Compass className="w-5 h-5 text-white" />
              </div>
              <span className="font-display font-bold text-xl tracking-tight truncate">MindTask</span>
            </div>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 py-4 px-2">
          <nav className="space-y-6">
            {!collapsed && (
              <p className="px-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Visão geral</p>
            )}
            <div className={`space-y-1 ${collapsed ? 'mt-2' : ''}`}>
              <Link href="/workspaces">
                <span
                  title="Todos os Espaços"
                  className={`flex items-center gap-3 rounded-xl transition-all duration-200 cursor-pointer ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'} ${isActive('/workspaces') && location === '/workspaces' ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                >
                  <Folders className="w-5 h-5 shrink-0" />
                  {!collapsed && <span>Todos os Espaços</span>}
                </span>
              </Link>
              <Link href="/my-tasks">
                <span
                  title="Minhas Tarefas"
                  className={`flex items-center gap-3 rounded-xl transition-all duration-200 cursor-pointer ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'} ${isActive('/my-tasks') ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                >
                  <CheckSquare className="w-5 h-5 shrink-0" />
                  {!collapsed && <span>Minhas Tarefas</span>}
                </span>
              </Link>
            </div>

            {!collapsed && (
              <div>
                <div className="px-3 mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Seus Espaços</p>
                  <Link href="/workspaces">
                    <span className="text-sidebar-foreground/40 hover:text-primary transition-colors cursor-pointer">
                      <Plus className="w-4 h-4" />
                    </span>
                  </Link>
                </div>
                
                {isWorkspacesLoading ? (
                  <div className="px-4 py-2 flex items-center gap-2 text-sidebar-foreground/40 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando...</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {workspaces?.map((ws) => (
                      <Link key={ws.id} href={`/workspaces/${ws.id}`}>
                        <span className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer ${isActive(`/workspaces/${ws.id}`) ? 'bg-sidebar-accent text-primary font-medium shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}>
                          <div className={`w-2 h-2 rounded-full shrink-0 ${isActive(`/workspaces/${ws.id}`) ? 'bg-primary' : 'bg-sidebar-foreground/20'}`} />
                          <span className="truncate">{ws.name}</span>
                        </span>
                      </Link>
                    ))}
                    {workspaces?.length === 0 && (
                      <p className="px-3 text-sm text-sidebar-foreground/40 italic">Nenhum espaço ainda</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {collapsed && (
              <div className="space-y-1">
                {workspaces?.map((ws) => (
                  <Link key={ws.id} href={`/workspaces/${ws.id}`}>
                    <span
                      title={ws.name}
                      className={`flex justify-center py-2.5 rounded-xl transition-all duration-200 cursor-pointer ${isActive(`/workspaces/${ws.id}`) ? 'bg-sidebar-accent text-primary' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                    >
                      <div className={`w-2 h-2 rounded-full ${isActive(`/workspaces/${ws.id}`) ? 'bg-primary' : 'bg-sidebar-foreground/30'}`} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className={`border-t border-sidebar-border/50 ${collapsed ? 'p-2' : 'p-4'}`}>
          {!collapsed && (
            <div className="flex items-center gap-3 px-2 py-3 mb-2">
              <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
                <p className="text-xs text-sidebar-foreground/50 truncate">{user.email}</p>
              </div>
            </div>
          )}

          {collapsed ? (
            <button
              title="Sair"
              onClick={() => logoutMutation.mutate()}
              className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <Button 
              variant="ghost" 
              className="w-full justify-start text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10"
              onClick={() => logoutMutation.mutate()}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        {children}
      </main>
    </div>
  );
}
