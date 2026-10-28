import { useRoute } from "wouter";
import { EmbedShell } from "@/components/embed/EmbedShell";
import { WorkspaceTasksPanel } from "@/components/workspaces/WorkspaceTasksPanel";

/**
 * `/embed/workspaces/:wsId/tasks[/:taskId]` — a aba de tarefas do workspace,
 * sem AppLayout, embutida num iframe pelo painel (`painel.beeads.com.br`).
 * O deep link `/tasks/:taskId` abre a tarefa como na página do workspace;
 * dentro do embed toda navegação é `replace` (ver `WorkspaceTasksPanel`).
 */
export default function EmbedWorkspaceTasksPage() {
  const [, listParams] = useRoute("/embed/workspaces/:wsId/tasks");
  const [, taskParams] = useRoute("/embed/workspaces/:wsId/tasks/:taskId");
  const workspaceId = listParams?.wsId || taskParams?.wsId || "";
  const deepLinkTaskId = taskParams?.taskId ?? null;

  return (
    <EmbedShell>
      <div className="flex-1 overflow-auto">
        <div className="pt-6 px-8 max-w-6xl mx-auto">
          <WorkspaceTasksPanel workspaceId={workspaceId} deepLinkTaskId={deepLinkTaskId} embedded />
        </div>
      </div>
    </EmbedShell>
  );
}
