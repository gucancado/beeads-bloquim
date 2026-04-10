import { useRef, useCallback } from "react";

export type NodePositionSnapshot = Record<string, { x: number; y: number }>;

const MAX_HISTORY = 50;

export function usePositionHistory() {
  const undoStack = useRef<NodePositionSnapshot[]>([]);
  const redoStack = useRef<NodePositionSnapshot[]>([]);

  const pushSnapshot = useCallback((snapshot: NodePositionSnapshot) => {
    undoStack.current.push(snapshot);
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift();
    }
    redoStack.current = [];
  }, []);

  const undo = useCallback(
    (currentSnapshot: NodePositionSnapshot): NodePositionSnapshot | null => {
      if (undoStack.current.length === 0) return null;
      const prev = undoStack.current.pop()!;
      redoStack.current.push(currentSnapshot);
      return prev;
    },
    [],
  );

  const redo = useCallback(
    (currentSnapshot: NodePositionSnapshot): NodePositionSnapshot | null => {
      if (redoStack.current.length === 0) return null;
      const next = redoStack.current.pop()!;
      undoStack.current.push(currentSnapshot);
      return next;
    },
    [],
  );

  const canUndo = () => undoStack.current.length > 0;
  const canRedo = () => redoStack.current.length > 0;

  return { pushSnapshot, undo, redo, canUndo, canRedo };
}
