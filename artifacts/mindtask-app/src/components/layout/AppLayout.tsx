import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout, customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, CheckSquare, Compass, Folders, Loader2, Map, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProfileSheet } from "@/components/profile/ProfileSheet";

interface RecentMap {
  mapId: string;
  workspaceId: string;
  mapName: string;
  workspaceName: string;
  lastAccessedAt: string;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar_collapsed") === "true"; } catch { return false; }
  });
  const [profileOpen, setProfileOpen] = useState(false);

  const { data: user, isLoading: isUserLoading } = useGetMe({
    query: { retry: false }
  });

  const { data: recentMaps, isLoading: isRecentMapsLoading } = useQuery<RecentMap[]>({
    queryKey: ["/api/maps/recent"],
    queryFn: () => customFetch("/api/maps/recent"),
    enabled: !!user,
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
  const isMapActive = (workspaceId: string, mapId: string) =>
    location === `/workspaces/${workspaceId}/maps/${mapId}`;

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
                  title="Suas tarefas"
                  className={`flex items-center gap-3 rounded-xl transition-all duration-200 cursor-pointer ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'} ${isActive('/my-tasks') ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                >
                  <CheckSquare className="w-5 h-5 shrink-0" />
                  {!collapsed && <span>Suas tarefas</span>}
                </span>
              </Link>
            </div>

            {!collapsed && (
              <div>
                <div className="px-3 mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">Planos Recentes</p>
                </div>

                {isRecentMapsLoading ? (
                  <div className="px-4 py-2 flex items-center gap-2 text-sidebar-foreground/40 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando...</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentMaps?.map((m) => (
                      <Link key={m.mapId} href={`/workspaces/${m.workspaceId}/maps/${m.mapId}`}>
                        <span className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer ${isMapActive(m.workspaceId, m.mapId) ? 'bg-sidebar-accent text-primary font-medium shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}>
                          <Map className={`w-3.5 h-3.5 shrink-0 ${isMapActive(m.workspaceId, m.mapId) ? 'text-primary' : 'text-sidebar-foreground/30'}`} />
                          <div className="flex flex-col min-w-0">
                            <span className="truncate text-sm font-medium leading-tight">{m.mapName}</span>
                            <span className="truncate text-xs text-sidebar-foreground/40 leading-tight mt-0.5">{m.workspaceName}</span>
                          </div>
                        </span>
                      </Link>
                    ))}
                    {recentMaps?.length === 0 && (
                      <p className="px-3 text-sm text-sidebar-foreground/40 italic">Nenhum plano acessado ainda</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {collapsed && (
              <div className="space-y-1">
                {recentMaps?.map((m) => (
                  <Link key={m.mapId} href={`/workspaces/${m.workspaceId}/maps/${m.mapId}`}>
                    <span
                      title={`${m.mapName} · ${m.workspaceName}`}
                      className={`flex justify-center py-2.5 rounded-xl transition-all duration-200 cursor-pointer ${isMapActive(m.workspaceId, m.mapId) ? 'bg-sidebar-accent text-primary' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                    >
                      <Map className={`w-3.5 h-3.5 ${isMapActive(m.workspaceId, m.mapId) ? 'text-primary' : 'text-sidebar-foreground/30'}`} />
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
            <button
              onClick={() => setProfileOpen(true)}
              className="w-full flex items-center gap-3 px-2 py-3 mb-2 rounded-xl hover:bg-sidebar-accent/50 transition-colors text-left"
              title="Editar perfil"
            >
              <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
                <p className="text-xs text-sidebar-foreground/50 truncate">{user.email}</p>
              </div>
            </button>
          )}

          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <button
                title={`${user.name} · Editar perfil`}
                onClick={() => setProfileOpen(true)}
                className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm hover:ring-2 hover:ring-primary/40 transition-all"
              >
                {user.name.charAt(0).toUpperCase()}
              </button>
              <button
                title="Sair"
                onClick={() => logoutMutation.mutate()}
                className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
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

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
