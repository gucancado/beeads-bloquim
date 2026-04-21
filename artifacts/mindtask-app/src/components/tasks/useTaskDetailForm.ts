import { useState, useEffect, useRef } from "react";
import type { RecurrenceConfig } from "@/components/tasks/RecurrencePanel";
import type { TaskResponse } from "@workspace/api-client-react";

interface TaskResponseExtended extends TaskResponse {
  overdue?: boolean;
  previousStatus?: string | null;
  isApprovalTask?: boolean;
  parentTaskId?: string | null;
  parentApprovalStatus?: string | null;
}

interface CardLike {
  title: string;
  description?: string | null;
  task?: TaskResponseExtended | null;
}

interface TaskLike {
  id: string;
  title: string;
  description: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
  workspaceId: string | null;
  mapId: string | null;
  isRecurring?: boolean;
  recurrenceConfig?: RecurrenceConfig | null;
}

export interface UseTaskDetailFormArgs {
  open: boolean;
  isCardMode: boolean;
  card: CardLike | undefined;
  task: TaskLike | undefined;
  resolvedTaskId: string | undefined;
  isEditing: boolean;
  setTaskWorkspaceId: (v: string | null) => void;
  setTaskMapId: (v: string | null) => void;
}

export function useTaskDetailForm({
  open,
  isCardMode,
  card,
  task,
  resolvedTaskId,
  isEditing,
  setTaskWorkspaceId,
  setTaskMapId,
}: UseTaskDetailFormArgs) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("unassigned");
  const [priority, setPriority] = useState<string>("medium");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<string>("pending");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceConfig, setRecurrenceConfig] = useState<RecurrenceConfig | null>(null);
  const [showRecurrencePanel, setShowRecurrencePanel] = useState(false);
  const initializedForTaskRef = useRef<string | null>(null);

  useEffect(() => {
    if (isCardMode && card) {
      setTitle(card.title);
      setDescription(card.description ?? "");
      if (card.task) {
        setPriority(card.task.priority);
        setStatus(card.task.status);
        setAssignedTo(card.task.assignedTo ?? "unassigned");
        setDueDate(card.task.dueDate ? card.task.dueDate.slice(0, 10) : "");
      } else {
        setPriority("medium");
        setStatus("pending");
        setAssignedTo("unassigned");
        setDueDate("");
      }
    }
  }, [card, isCardMode]);

  useEffect(() => {
    if (!isCardMode) {
      if (task && isEditing && task.id === resolvedTaskId) {
        if (initializedForTaskRef.current !== resolvedTaskId) {
          initializedForTaskRef.current = resolvedTaskId;
          setTitle(task.title ?? "");
          setDescription(task.description ?? "");
          setAssignedTo(task.assignedTo ?? "unassigned");
          setPriority(task.priority ?? "medium");
          setDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
          setStatus(task.status ?? "pending");
          setTaskWorkspaceId(task.workspaceId ?? null);
          setTaskMapId(task.mapId ?? null);
          setIsRecurring(task.isRecurring ?? false);
          setRecurrenceConfig(task.recurrenceConfig ?? null);
        }
      } else if (!isEditing) {
        initializedForTaskRef.current = null;
        setTitle("");
        setDescription("");
        setAssignedTo("unassigned");
        setPriority("medium");
        setDueDate("");
        setStatus("pending");
        setIsRecurring(false);
        setRecurrenceConfig(null);
        setShowRecurrencePanel(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, isEditing, open, isCardMode, resolvedTaskId]);

  return {
    title, setTitle,
    description, setDescription,
    assignedTo, setAssignedTo,
    priority, setPriority,
    dueDate, setDueDate,
    status, setStatus,
    isRecurring, setIsRecurring,
    recurrenceConfig, setRecurrenceConfig,
    showRecurrencePanel, setShowRecurrencePanel,
  };
}
