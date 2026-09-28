import { PointerSensor } from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";

const INTERACTIVE = ".nodrag, [data-no-dnd], input, textarea, select, button, a, [contenteditable='true'], [role='menu'], [role='dialog']";

/**
 * O card do calendário é o mesmo do canvas, cheio de controles inline.
 * Drag só começa em área "neutra" do card: ignora controles e eventos que
 * borbulham de popovers em portal (o React propaga eventos de portal para o
 * ancestral do componente, mas o alvo DOM não está dentro do card).
 */
export class CalendarPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent, currentTarget }: ReactPointerEvent) => {
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) return false;
        const target = nativeEvent.target as Element | null;
        if (!target || !(currentTarget as Element).contains(target)) return false;
        return !target.closest(INTERACTIVE);
      },
    },
  ];
}
