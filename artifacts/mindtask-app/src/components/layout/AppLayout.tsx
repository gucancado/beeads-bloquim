import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import {
  CheckSquare,
  NotebookPen,
  Folders,
  Loader2,
  User as UserIcon,
  FileText as FileTextIcon,
  Plug as PlugIcon,
  Zap as ZapIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarBody,
  SidebarFooter,
  SidebarNavItem,
  SidebarTrigger,
  useSidebar,
} from "@beeads/ui";
import { ProfileSheet } from "@/components/profile/ProfileSheet";
import { SidebarWorkspaceList } from "@/components/layout/SidebarWorkspaceList";
import { GlobalTaskSearch } from "@/components/layout/GlobalTaskSearch";

function WorkspaceListSection({ enabled }: { enabled: boolean }) {
  const { collapsed } = useSidebar();
  return <SidebarWorkspaceList collapsed={collapsed} enabled={enabled} />;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const sidebarViewportRef = useRef<HTMLDivElement | null>(null);

  const { data: user, isLoading: isUserLoading } = useGetMe({
    query: { retry: false },
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        try {
          localStorage.removeItem("mindtask_token");
        } catch {}
        window.location.href = "/login";
      },
      onError: () => {
        try {
          localStorage.removeItem("mindtask_token");
        } catch {}
        window.location.href = "/login";
      },
    },
  });

  useEffect(() => {
    if (!isUserLoading && !user) {
      setLocation("/login");
    }
  }, [isUserLoading, user, setLocation]);

  // Persist + restore the sidebar nav scroll position across navigations.
  // Uses the SidebarBody's ScrollArea viewport (exposed via viewportRef in
  // @beeads/ui >= 0.5.0). Restoration retries once the workspace list grows
  // tall enough (async-loaded), via a ResizeObserver.
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

  const settingsItems = [
    {
      label: "perfil",
      icon: <UserIcon className="h-4 w-4" />,
      onSelect: () => setProfileOpen(true),
    },
    {
      label: "modelos de tarefas",
      icon: <FileTextIcon className="h-4 w-4" />,
      onSelect: () => setLocation("/my-templates"),
    },
    {
      label: "integrações",
      icon: <PlugIcon className="h-4 w-4" />,
      onSelect: () => setLocation("/settings/integrations"),
    },
    {
      label: "mcp",
      icon: <ZapIcon className="h-4 w-4" />,
      onSelect: () => setLocation("/settings/mcp"),
    },
  ];

  const avatarUrl = (user as { avatarUrl?: string | null }).avatarUrl ?? null;

  return (
    <SidebarProvider persist="localStorage" storageKey="sidebar_collapsed">
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar>
          <SidebarHeader
            logo={<NotebookPen />}
            title={
              <>
                blo<span className="italic text-honey-deep">·</span>quim
              </>
            }
          />
          <SidebarBody viewportRef={sidebarViewportRef}>
            <nav className="space-y-6">
              <div className="space-y-1">
                <SidebarNavItem
                  icon={<CheckSquare />}
                  label="tarefas"
                  title="tarefas"
                  active={isActive("/my-tasks")}
                  render={(props) => <Link href="/my-tasks" {...props} />}
                />
                <SidebarNavItem
                  icon={<Folders />}
                  label="espaços de trabalho"
                  title="espaços de trabalho"
                  active={isActive("/workspaces") && location === "/workspaces"}
                  render={(props) => <Link href="/workspaces" {...props} />}
                />
              </div>
              <WorkspaceListSection enabled={!!user} />
            </nav>
          </SidebarBody>
          <SidebarFooter
            user={{ name: user.name, email: user.email, avatarUrl }}
            settingsItems={settingsItems}
            onLogout={() => logoutMutation.mutate()}
            onProfileClick={() => setProfileOpen(true)}
          />
        </Sidebar>

        <main className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          <header className="flex shrink-0 items-center gap-2 border-b border-border p-2 md:hidden">
            <SidebarTrigger />
            <span className="font-display text-sm">bloquim</span>
          </header>
          <div className="flex-1 min-h-0 flex flex-col">{children}</div>
          <GlobalTaskSearch />
        </main>

        <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />
      </div>
    </SidebarProvider>
  );
}
