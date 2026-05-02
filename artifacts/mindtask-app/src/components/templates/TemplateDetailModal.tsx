import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Flag, Loader2, ListChecks, GripVertical, X, Plus } from "lucide-react";
import { PriorityBadge } from "@/components/tasks/PriorityBadge";
import { DescriptionEditor } from "@/components/tasks/DescriptionEditor";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface TemplateSubtask {
  id: string;
  title: string;
  order: number;
}

interface Template {
  id: string;
  name: string | null;
  title: string | null;
  description: string | null;
  priority: string | null;
  subtasks: TemplateSubtask[];
}

interface LocalSubtask {
  id: string;
  title: string;
  order: number;
  isLocal?: boolean;
}

function generateLocalId() {
  return `local-${Math.random().toString(36).slice(2)}`;
}

function SortableSubtaskRow({
  subtask,
  onChange,
  onBlur,
  onDelete,
  onKeyDown,
  inputRef,
}: {
  subtask: LocalSubtask;
  onChange: (id: string, title: string) => void;
  onBlur: (id: string) => void;
  onDelete: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, id: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 group rounded-lg px-1 py-0.5"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none"
        tabIndex={-1}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <input
        ref={inputRef}
        value={subtask.title}
        onChange={(e) => onChange(subtask.id, e.target.value)}
        onBlur={() => onBlur(subtask.id)}
        onKeyDown={(e) => onKeyDown(e, subtask.id)}
        className="flex-1 bg-transparent text-sm outline-none border-none focus:outline-none placeholder:text-muted-foreground/40"
        placeholder="Subtarefa..."
      />
      <button
        onClick={() => onDelete(subtask.id)}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-destructive transition-opacity shrink-0"
        title="Remover"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function TemplateDetailModal({
  templateId,
  open,
  onClose,
}: {
  templateId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: template, isLoading } = useQuery<Template>({
    queryKey: ["/api/task-templates", templateId],
    queryFn: () => customFetch(`/api/task-templates/${templateId}`),
    enabled: open && !!templateId,
  });

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [subtasks, setSubtasks] = useState<LocalSubtask[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [dialogContentEl, setDialogContentEl] = useState<HTMLDivElement | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const initializedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedRef.current = null;
      return;
    }
    if (template && initializedRef.current !== template.id) {
      initializedRef.current = template.id;
      setName(template.name ?? "");
      setTitle(template.title ?? "");
      setDescription(template.description ?? "");
      setPriority(template.priority ?? "");
      setSubtasks(
        (template.subtasks ?? []).map((s) => ({ id: s.id, title: s.title, order: s.order })),
      );
    }
  }, [template, open]);

  useEffect(() => {
    if (pendingFocusId && inputRefs.current[pendingFocusId]) {
      inputRefs.current[pendingFocusId]?.focus();
      setPendingFocusId(null);
    }
  }, [pendingFocusId, subtasks]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/task-templates"] });
    if (templateId) queryClient.invalidateQueries({ queryKey: ["/api/task-templates", templateId] });
  };

  const patchTemplate = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`/api/task-templates/${templateId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidate(),
  });

  const createSubtaskMut = useMutation({
    mutationFn: (input: { title: string; order: number; localId: string }) =>
      customFetch<TemplateSubtask>(`/api/task-templates/${templateId}/subtasks`, {
        method: "POST",
        body: JSON.stringify({ title: input.title, order: input.order }),
      }).then((created) => ({ created, localId: input.localId })),
    onSuccess: ({ created, localId }) => {
      setSubtasks((prev) =>
        prev.map((s) => (s.id === localId ? { id: created.id, title: created.title, order: created.order } : s)),
      );
      invalidate();
    },
  });

  const updateSubtaskMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      customFetch(`/api/task-templates/${templateId}/subtasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    onSuccess: () => invalidate(),
  });

  const deleteSubtaskMut = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/task-templates/${templateId}/subtasks/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
  });

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) =>
      customFetch(`/api/task-templates/${templateId}/subtasks/reorder`, {
        method: "PUT",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => invalidate(),
  });

  const addSubtask = () => {
    const localId = generateLocalId();
    const order = subtasks.length;
    setSubtasks((prev) => [...prev, { id: localId, title: "", order, isLocal: true }]);
    setPendingFocusId(localId);
  };

  const handleSubChange = (id: string, value: string) => {
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, title: value } : s)));
  };

  const handleSubBlur = (id: string) => {
    const sub = subtasks.find((s) => s.id === id);
    if (!sub) return;
    const trimmed = sub.title.trim();
    if (sub.isLocal || id.startsWith("local-")) {
      if (!trimmed) {
        setSubtasks((prev) => prev.filter((s) => s.id !== id));
        return;
      }
      createSubtaskMut.mutate({ title: trimmed, order: sub.order, localId: id });
    } else {
      if (!trimmed) {
        setSubtasks((prev) => prev.filter((s) => s.id !== id));
        deleteSubtaskMut.mutate(id);
        return;
      }
      const original = template?.subtasks.find((s) => s.id === id);
      if (original && original.title !== trimmed) {
        updateSubtaskMut.mutate({ id, title: trimmed });
      }
    }
  };

  const handleSubKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
      addSubtask();
    } else if (e.key === "Backspace") {
      const sub = subtasks.find((s) => s.id === id);
      if (sub && sub.title === "") {
        e.preventDefault();
        setSubtasks((prev) => prev.filter((s) => s.id !== id));
        if (!sub.isLocal && !id.startsWith("local-")) {
          deleteSubtaskMut.mutate(id);
        }
      }
    }
  };

  const handleSubDelete = (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
    if (!id.startsWith("local-")) {
      deleteSubtaskMut.mutate(id);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSubtasks((prev) => {
      const oldIdx = prev.findIndex((s) => s.id === active.id);
      const newIdx = prev.findIndex((s) => s.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(prev, oldIdx, newIdx).map((s, i) => ({ ...s, order: i }));
      const persistedIds = next.filter((s) => !s.id.startsWith("local-")).map((s) => s.id);
      if (persistedIds.length > 0) reorderMut.mutate(persistedIds);
      return next;
    });
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent
        ref={setDialogContentEl}
        hideClose
        className="w-full max-w-2xl p-0 flex flex-col gap-0 overflow-hidden max-h-[90vh] rounded-2xl"
        onInteractOutside={(e) => {
          e.preventDefault();
          handleClose();
        }}
      >
        <DialogTitle className="sr-only">Editar modelo</DialogTitle>
        <DialogDescription className="sr-only">Formulário de modelo de tarefa</DialogDescription>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {isLoading || !template ? (
            <div className="flex-1 flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="p-5 space-y-4 flex-1">
              <div>
                <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">
                  Nome do modelo
                </label>
                <Input
                  value={name}
                  autoCapitalize="none"
                  placeholder="Ex: revisão semanal"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => {
                    if ((template.name ?? "") !== name) patchTemplate.mutate({ name: name || null });
                  }}
                  className="bg-background rounded-xl"
                />
              </div>

              <div className="border-t pt-4 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">
                    Título da tarefa
                  </label>
                  <Input
                    value={title}
                    autoCapitalize="none"
                    placeholder="Título a ser aplicado"
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => {
                      if ((template.title ?? "") !== title) patchTemplate.mutate({ title: title || null });
                    }}
                    className="bg-background rounded-xl"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                    <Flag className="w-3 h-3" /> Prioridade
                  </label>
                  <div className="flex items-center h-10 px-2">
                    <PriorityBadge
                      value={priority}
                      onChange={(v) => {
                        setPriority(v);
                        patchTemplate.mutate({ priority: v ? v : null });
                      }}
                      portalContainer={dialogContentEl}
                      allowEmpty
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center mb-1.5">
                    <button
                      onClick={addSubtask}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-muted"
                      title="Adicionar subtarefa"
                    >
                      <ListChecks className="w-3.5 h-3.5" />
                      <span className="lowercase">subtarefas +</span>
                    </button>
                  </div>
                  {subtasks.length > 0 && (
                    <div className="bg-muted/30 rounded-xl px-2 py-1.5 space-y-0.5">
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={subtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                          {subtasks.map((s) => (
                            <SortableSubtaskRow
                              key={s.id}
                              subtask={s}
                              onChange={handleSubChange}
                              onBlur={handleSubBlur}
                              onDelete={handleSubDelete}
                              onKeyDown={handleSubKeyDown}
                              inputRef={(el) => {
                                inputRefs.current[s.id] = el;
                              }}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">
                    Descrição
                  </label>
                  <DescriptionEditor
                    value={description}
                    onChange={setDescription}
                    onBlur={() => {
                      if ((template.description ?? "") !== description) {
                        patchTemplate.mutate({ description: description || null });
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
