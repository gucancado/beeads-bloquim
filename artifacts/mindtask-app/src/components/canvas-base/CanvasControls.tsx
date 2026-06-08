import { Controls, ControlButton, useReactFlow } from "reactflow";

/**
 * Controles de zoom/enquadrar do canvas — genéricos, compartilhados pelos modos
 * action e strategy (Fase 1 do Mapa Estratégico). Renderizado dentro do
 * <ReactFlow>, então usa useReactFlow() diretamente.
 */
export function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Controls className="bg-card border border-border shadow-md rounded-xl overflow-hidden" showZoom={false} showFitView={false} showInteractive={false}>
      <ControlButton title="aproximar" onClick={() => zoomIn()}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" /></svg>
      </ControlButton>
      <ControlButton title="afastar" onClick={() => zoomOut()}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M32 18.133H0v-4.266h32z" /></svg>
      </ControlButton>
      <ControlButton title="enquadrar" onClick={() => fitView()}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M5.333 16c0-5.891 4.776-10.667 10.667-10.667S26.667 10.109 26.667 16 21.891 26.667 16 26.667 5.333 21.891 5.333 16zM16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z" /></svg>
      </ControlButton>
    </Controls>
  );
}
