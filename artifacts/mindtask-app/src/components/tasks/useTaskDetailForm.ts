import { useState, useEffect, useRef } from "react";
import type { RecurrenceConfig } from "@/components/tasks/RecurrencePanel";
import type { TaskResponse } from "@workspace/api-client-react";

interface TaskResponseExtended extends TaskResponse {
  overdue?: boolean;
  previousStatus?: string | null;
  isApprovalTask?: boolean;
  parentTaskId?: string | null;
  parentApprovalStatus?: string | null;
  startAt?: string | null;
  scheduleMode?: "ate" | "entre" | "em" | null;
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
  startAt?: string | null;
  scheduleMode?: "ate" | "entre" | "em" | null;
  priority: string;
  status: string;
  workspaceId: string | null;
  mapId: string | null;
  isRecurring?: boolean;
  recurrenceConfig?: RecurrenceConfig | null;
}

export type ScheduleMode = "ate" | "entre" | "em";

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
  const [startAt, setStartAt] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("ate");
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
        setStartAt(card.task.startAt ? card.task.startAt.slice(0, 10) : "");
        setScheduleMode((card.task.scheduleMode ?? "ate") as ScheduleMode);
      } else {
        setPriority("medium");
        setStatus("pending");
        setAssignedTo("unassigned");
        setDueDate("");
        setStartAt("");
        setScheduleMode("ate");
      }
    }
  }, [card, isCardMode]);

  useEffect(() => {
    if (!isCardMode) {
      if (task && isEditing && task.id === resolvedTaskId) {
        // Fields that are auto-saved immediately on change — always keep in sync
        // with the latest server data so that changes made on the canvas node or
        // another view are reflected in the modal without requiring a close/reopen.
        setDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
        setStartAt(task.startAt ? task.startAt.split("T")[0] : "");
        setScheduleMode((task.scheduleMode ?? "ate") as ScheduleMode);
        setPriority(task.priority ?? "medium");
        setAssignedTo(task.assignedTo ?? "unassigned");
        setStatus(task.status ?? "pending");
        setTaskWorkspaceId(task.workspaceId ?? null);
        setTaskMapId(task.mapId ?? null);
        setIsRecurring(task.isRecurring ?? false);
        setRecurrenceConfig(task.recurrenceConfig ?? null);
        // Title and description may have unsaved local edits — only initialise
        // once per task to avoid wiping in-progress text.
        if (initializedForTaskRef.current !== resolvedTaskId) {
          initializedForTaskRef.current = resolvedTaskId;
          setTitle(task.title ?? "");
          setDescription(task.description ?? "");
        }
      } else if (!isEditing) {
        initializedForTaskRef.current = null;
        setTitle("");
        setDescription("");
        setAssignedTo("unassigned");
        setPriority("medium");
        setDueDate("");
        setStartAt("");
        setScheduleMode("ate");
        setStatus("pending");
        setIsRecurring(false);
        setRecurrenceConfig(null);
        setShowRecurrencePanel(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, isEditing, open, isCardMode, resolvedTaskId]);

  const resetTitleDescriptionInit = () => {
    initializedForTaskRef.current = null;
  };

  return {
    title, setTitle,
    description, setDescription,
    assignedTo, setAssignedTo,
    priority, setPriority,
    dueDate, setDueDate,
    startAt, setStartAt,
    scheduleMode, setScheduleMode,
    status, setStatus,
    isRecurring, setIsRecurring,
    recurrenceConfig, setRecurrenceConfig,
    showRecurrencePanel, setShowRecurrencePanel,
    resetTitleDescriptionInit,
  };
}
