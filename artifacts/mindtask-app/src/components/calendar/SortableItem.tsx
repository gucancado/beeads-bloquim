import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

/**
 * `dragDisabled` só impede arrastar: o item continua alvo de drop. Em dia
 * passado isso faz o drop cair na coluna passada (e o computeDrop recusar com
 * `past`) em vez de escorregar para a coluna habilitada mais próxima.
 */
export function SortableItem({ id, dragDisabled, children }: { id: string; dragDisabled?: boolean; children: ReactNode }) {
  // Só há PointerSensor: role/tabIndex/aria-roledescription do dnd-kit
  // anunciariam um "botão" arrastável por teclado que não existe. Mantém só
  // os atributos de estado (aria-disabled/aria-pressed/aria-describedby).
  const { attributes: { role: _role, tabIndex: _tabIndex, "aria-roledescription": _ard, ...attributes }, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: { draggable: !!dragDisabled, droppable: false },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      data-calendar-item={id}
      className={dragDisabled ? "" : "cursor-grab active:cursor-grabbing"}
    >
      {children}
    </div>
  );
}
