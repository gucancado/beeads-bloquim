import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { SubtaskItem } from "./SortableSubtask";

function generateLocalId() {
  return `local-${Math.random().toString(36).slice(2)}`;
}

export interface UseSubtasksStateArgs {
  taskIdResolved: string | undefined;
  effectiveWorkspaceId: string;
  open: boolean;
  markDirty: () => void;
}

export function useSubtasksState({
  taskIdResolved,
  effectiveWorkspaceId,
  open,
  markDirty,
}: UseSubtasksStateArgs) {
  const [subtasks, setSubtasks] = useState<SubtaskItem[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const subtasksEndpoint = effectiveWorkspaceId
    ? `/api/workspaces/${effectiveWorkspaceId}/tasks/${taskIdResolved}/subtasks`
    : `/api/my-tasks/${taskIdResolved}/subtasks`;

  const { data: subtasksData } = useQuery<SubtaskItem[]>({
    queryKey: [subtasksEndpoint],
    queryFn: () => customFetch(subtasksEndpoint),
    enabled: open && !!taskIdResolved,
  });

  useEffect(() => {
    if (subtasksData) setSubtasks(subtasksData);
  }, [subtasksData]);

  useEffect(() => {
    if (pendingFocusId && inputRefs.current[pendingFocusId]) {
      inputRefs.current[pendingFocusId]?.focus();
      setPendingFocusId(null);
    }
  }, [pendingFocusId, subtasks]);

  const saveSubtasksMutation = useMutation({
    mutationFn: (items: SubtaskItem[]) =>
      customFetch(subtasksEndpoint, {
        method: "PUT",
        body: JSON.stringify({ subtasks: items.map((s, idx) => ({ id: s.id.startsWith("local-") ? undefined : s.id, text: s.text, completed: s.completed, order: idx })) }),
      }),
    onSuccess: (data: SubtaskItem[]) => {
      setSubtasks(prev => {
        const newLocal = prev.filter(s => s.id.startsWith("local-") && s.text.trim() === "");
        return [...data, ...newLocal];
      });
    },
  });

  const addSubtask = (afterId?: string) => {
    const newId = generateLocalId();
    setSubtasks(prev => {
      if (afterId) {
        const idx = prev.findIndex(s => s.id === afterId);
        const insertAt = idx >= 0 ? idx + 1 : prev.length;
        const next = [...prev];
        next.splice(insertAt, 0, { id: newId, text: "", completed: false, order: insertAt });
        return next;
      }
      return [...prev, { id: newId, text: "", completed: false, order: prev.length }];
    });
    setPendingFocusId(newId);
    markDirty();
  };

  const handleChange = (id: string, text: string) => {
    setSubtasks(prev => prev.map(s => s.id === id ? { ...s, text } : s));
    markDirty();
  };

  const handleToggle = (id: string) => {
    const updated = subtasks.map(s => s.id === id ? { ...s, completed: !s.completed } : s);
    setSubtasks(updated);
    markDirty();
    if (taskIdResolved) saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
  };

  const handleBlur = (id: string) => {
    const subtask = subtasks.find(s => s.id === id);
    if (subtask && subtask.text.trim() === "") {
      const updated = subtasks.filter(s => s.id !== id);
      setSubtasks(updated);
      if (taskIdResolved) saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
    } else if (taskIdResolved) {
      saveSubtasksMutation.mutate(subtasks.filter(s => s.text.trim() !== ""));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Backspace") {
      const subtask = subtasks.find(s => s.id === id);
      if (subtask && subtask.text === "") {
        e.preventDefault();
        const updated = subtasks.filter(s => s.id !== id);
        setSubtasks(updated);
        if (taskIdResolved) saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      addSubtask(id);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = subtasks.findIndex(s => s.id === active.id);
      const newIndex = subtasks.findIndex(s => s.id === over.id);
      const reordered = arrayMove(subtasks, oldIndex, newIndex);
      setSubtasks(reordered);
      if (taskIdResolved) saveSubtasksMutation.mutate(reordered.filter(s => s.text.trim() !== ""));
    }
  };

  const flushPending = () => {
    if (taskIdResolved) {
      saveSubtasksMutation.mutate(subtasks.filter(s => s.text.trim() !== ""));
    }
  };

  return {
    subtasks,
    setSubtasks,
    sensors,
    inputRefs,
    addSubtask,
    handleChange,
    handleToggle,
    handleBlur,
    handleKeyDown,
    handleDragEnd,
    flushPending,
  };
}
