import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { LogOut, CheckSquare, NotebookPen, Folders, Loader2, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { ScrollArea } from "@beeads/ui";
import { Avatar, AvatarImage, AvatarFallback } from "@beeads/ui";
import { ProfileSheet } from "@/components/profile/ProfileSheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@beeads/ui";
import { User as UserIcon, FileText as FileTextIcon, Plug as PlugIcon, Zap as ZapIcon } from "lucide-react";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { SidebarWorkspaceList } from "@/components/layout/SidebarWorkspaceList";
import { GlobalTaskSearch } from "@/components/layout/GlobalTaskSearch";

function SettingsDropdown({ onProfile, onNavigate }: { onProfile: () => void; onNavigate: (path: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title="configurações"
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all focus:outline-none"
        >
          <Settings className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuItem onSelect={() => onProfile()} className="lowercase cursor-pointer">
          <UserIcon className="w-4 h-4 mr-2" /> perfil
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNavigate("/my-templates")} className="lowercase cursor-pointer">
          <FileTextIcon className="w-4 h-4 mr-2" /> modelos de tarefas
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNavigate("/settings/integrations")} className="lowercase cursor-pointer">
          <PlugIcon className="w-4 h-4 mr-2" /> integrações
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNavigate("/settings/mcp")} className="lowercase cursor-pointer">
          <ZapIcon className="w-4 h-4 mr-2" /> mcp
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar_collapsed") === "true"; } catch { return false; }
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const sidebarViewportRef = useRef<HTMLDivElement | null>(null);

  const { data: user, isLoading: isUserLoading } = useGetMe({
    query: { retry: false }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        try { localStorage.removeItem("mindtask_token"); } catch {}
        window.location.href = "/login";
      },
      onError: () => {
        try { localStorage.removeItem("mindtask_token"); } catch {}
        window.location.href = "/login";
      },
    }
  });

  useEffect(() => {
    if (!isUserLoading && !user) {
      setLocation("/login");
    }
  }, [isUserLoading, user, setLocation]);

  useEffect(() => {
    if (!user) return;
    const viewport = sidebarViewportRef.current;
    if (!viewport) return;

    const STORAGE_KEY = "sidebar_scroll_top";
    const saved = Number(sessionStorage.getItem(STORAGE_KEY) ?? 0);

    let restored = false;
    const tryRestore = () => {
      if (restored) return;
      const maxScroll = viewport.scrollHeight - viewport.clientHeight;
      if (maxScroll <= 0) return;
      viewport.scrollTop = Math.min(saved, maxScroll);
      if (viewport.scrollTop === Math.min(saved, maxScroll)) {
        restored = true;
      }
    };

    tryRestore();

    let observer: ResizeObserver | null = null;
    if (!restored && saved > 0) {
      observer = new ResizeObserver(() => {
        tryRestore();
        if (restored) observer?.disconnect();
      });
      observer.observe(viewport);
      if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    }

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        sessionStorage.setItem(STORAGE_KEY, String(viewport.scrollTop));
      });
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [user]);

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
        <div className="flex items-center gap-2 p-4 pr-3 border-b border-sidebar-border/50 min-h-[65px]">
          {!collapsed && (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <NotebookPen className="w-6 h-6 shrink-0 text-primary" />
              <span className="font-display font-bold text-xl tracking-tight truncate lowercase">Bloquim</span>
            </div>
          )}
          <div className={`flex items-center gap-1 ${collapsed ? 'flex-col w-full' : ''}`}>
            <ThemeToggle />
            <button
              onClick={toggleCollapsed}
              title={collapsed ? "expandir menu" : "recolher menu"}
              className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all"
            >
              {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 py-4 px-2" viewportRef={sidebarViewportRef}>
          <nav className="space-y-6">
            <div className={`space-y-1 ${collapsed ? 'mt-2' : ''}`}>
              <Link href="/my-tasks">
                <span
                  title="tarefas"
                  className={`flex items-center gap-3 rounded-xl transition-all duration-200 cursor-pointer ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'} ${isActive('/my-tasks') ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                >
                  <CheckSquare className="w-5 h-5 shrink-0" />
                  {!collapsed && <span className="lowercase">Tarefas</span>}
                </span>
              </Link>
              <Link href="/workspaces">
                <span
                  title="espaços de trabalho"
                  className={`flex items-center gap-3 rounded-xl transition-all duration-200 cursor-pointer ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'} ${isActive('/workspaces') && location === '/workspaces' ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                >
                  <Folders className="w-5 h-5 shrink-0" />
                  {!collapsed && <span className="lowercase">Espaços de Trabalho</span>}
                </span>
              </Link>
            </div>

            <SidebarWorkspaceList collapsed={collapsed} enabled={!!user} />
          </nav>
        </ScrollArea>

        {/* Footer */}
        <div className={`border-t border-sidebar-border/50 ${collapsed ? 'p-2' : 'p-4'}`}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setProfileOpen(true)}
                className="flex-1 min-w-0 flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-sidebar-accent/50 transition-colors text-left"
                title="editar perfil"
              >
                <Avatar className="w-9 h-9 rounded-full shrink-0">
                  {(user as { avatarUrl?: string | null }).avatarUrl && (
                    <AvatarImage src={(user as { avatarUrl?: string | null }).avatarUrl!} alt={user.name} className="object-cover" />
                  )}
                  <AvatarFallback className="bg-primary/20 text-primary font-bold text-sm">
                    {user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
                  <p className="text-xs text-sidebar-foreground/50 truncate">{user.email}</p>
                </div>
              </button>
              <SettingsDropdown
                onProfile={() => setProfileOpen(true)}
                onNavigate={(path) => setLocation(path)}
              />
              <button
                title="sair"
                onClick={() => logoutMutation.mutate()}
                className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}

          {collapsed && (
            <div className="flex flex-col items-center gap-2">
              <button
                title={`${user.name} · editar perfil`}
                onClick={() => setProfileOpen(true)}
                className="w-10 h-10 rounded-full hover:ring-2 hover:ring-primary/40 transition-all shrink-0"
              >
                <Avatar className="w-10 h-10 rounded-full">
                  {(user as { avatarUrl?: string | null }).avatarUrl && (
                    <AvatarImage src={(user as { avatarUrl?: string | null }).avatarUrl!} alt={user.name} className="object-cover" />
                  )}
                  <AvatarFallback className="bg-primary/20 text-primary font-bold text-sm">
                    {user.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </button>
              <SettingsDropdown
                onProfile={() => setProfileOpen(true)}
                onNavigate={(path) => setLocation(path)}
              />
              <button
                title="sair"
                onClick={() => logoutMutation.mutate()}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        {children}
        <GlobalTaskSearch />
      </main>

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
