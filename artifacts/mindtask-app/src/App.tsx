import { Component, ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import WorkspacesPage from "@/pages/workspaces/index";
import WorkspaceDetailPage from "@/pages/workspaces/detail";
import CanvasPage from "@/pages/maps/canvas";
import MyTasksPage from "@/pages/my-tasks";
import TemplatesPage from "@/pages/templates";
import SettingsIntegrationsPage from "@/pages/settings/integrations";
import SettingsMcpPage from "@/pages/settings/mcp";
import PrivacidadePage from "@/pages/privacidade";
import TermosPage from "@/pages/termos";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      throwOnError: false,
      retry: false,
      // Default staleTime is 0 — every component mount triggers a refetch.
      // 30s kills the redundant refetch storm; routes that need fresher data
      // (canvas map polling) override per-query.
      staleTime: 30_000,
    },
    mutations: { throwOnError: false },
  },
});

// Patch invalidateQueries so that any refetch-failure it triggers never
// produces an unhandled Promise rejection.  Without this the proxy frame's
// cross-frame unhandledrejection listener intercepts the rejection before our
// own preventDefault() handler and reports a spurious "not an error object"
// crash every time a background refetch fails (e.g. right after card creation).
{
  const _orig = queryClient.invalidateQueries.bind(queryClient);
  (queryClient as unknown as Record<string, unknown>).invalidateQueries = (
    ...args: Parameters<typeof queryClient.invalidateQueries>
  ) => _orig(...args).catch(() => undefined);
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
          <p className="text-lg font-medium text-muted-foreground lowercase">algo deu errado.</p>
          <button
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm lowercase"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/workspaces" component={WorkspacesPage} />
      <Route path="/workspaces/:wsId/tasks/:taskId" component={WorkspaceDetailPage} />
      <Route path="/workspaces/:id" component={WorkspaceDetailPage} />
      <Route path="/workspaces/:wsId/maps/:mapId" component={CanvasPage} />
      <Route path="/my-tasks/tasks/:taskId" component={MyTasksPage} />
      <Route path="/my-tasks" component={MyTasksPage} />
      <Route path="/my-templates" component={TemplatesPage} />
      <Route path="/settings/integrations" component={SettingsIntegrationsPage} />
      <Route path="/settings/mcp" component={SettingsMcpPage} />
      <Route path="/privacidade" component={PrivacidadePage} />
      <Route path="/termos" component={TermosPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="mindtask-theme">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
