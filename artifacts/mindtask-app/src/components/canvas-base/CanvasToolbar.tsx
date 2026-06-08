import type { ReactNode } from "react";

/**
 * Shell posicional da toolbar do canvas — genérico, compartilhado pelos modos
 * action e strategy (Fase 1, Fatia B do Mapa Estratégico). Só provê o
 * container fixo embaixo/centro; os botões (específicos do modo) entram como
 * `children` (o slot `toolbarItems`). Sem lógica de negócio aqui.
 */
export function CanvasToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
      {children}
    </div>
  );
}
