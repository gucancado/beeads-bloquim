import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import WorkspacesPage from "@/pages/workspaces/index";
import WorkspaceDetailPage from "@/pages/workspaces/detail";
import CanvasPage from "@/pages/maps/canvas";
import MyTasksPage from "@/pages/my-tasks";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/workspaces" component={WorkspacesPage} />
      <Route path="/workspaces/:id" component={WorkspaceDetailPage} />
      <Route path="/workspaces/:wsId/maps/:mapId" component={CanvasPage} />
      <Route path="/my-tasks" component={MyTasksPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
