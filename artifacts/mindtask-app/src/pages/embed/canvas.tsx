import { useRoute } from "wouter";
import { ReactFlowProvider } from "reactflow";
import { EmbedShell } from "@/components/embed/EmbedShell";
import { CanvasInner } from "@/pages/maps/canvas";

/**
 * `/embed/workspaces/:wsId/maps/:mapId` — o canvas do plano sem AppLayout,
 * embutido num iframe pelo painel (`painel.beeads.com.br`). `?cardId=` abre
 * a tarefa como na página normal; dentro do embed toda navegação é `replace`
 * (ver `CanvasInner`).
 */
export default function EmbedCanvasPage() {
  const [, params] = useRoute("/embed/workspaces/:wsId/maps/:mapId");
  const workspaceId = params?.wsId || "";
  const mapId = params?.mapId || "";

  return (
    <EmbedShell>
      <ReactFlowProvider>
        <CanvasInner workspaceId={workspaceId} mapId={mapId} embedded />
      </ReactFlowProvider>
    </EmbedShell>
  );
}
