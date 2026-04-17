import { useState, useEffect, useRef, useCallback } from "react";
import { X, CheckSquare } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import type { WorkspaceMemberResponse } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const MAX_APPROVERS = 3;

interface ApprovalItem {
  id: string;
  title: string;
  status: string;
  approvalOrder: number | null;
  approvalStatus: string | null;
  dueDate: string | null;
  assignedTo: string | null;
  approverName: string | null;
  approverAvatarUrl: string | null;
}

function SortableApproverAvatar({
  approval,
  onRemove,
  selectedId,
  onSelect,
}: {
  approval: ApprovalItem;
  onRemove: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: approval.id });
  const [hovered, setHovered] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isSelected = selectedId === approval.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative flex-shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={e => {
        if (e.key === 'Delete' && isSelected) {
          onRemove(approval.id);
        }
      }}
      tabIndex={0}
      onClick={() => onSelect(isSelected ? null : approval.id)}
    >
      <div
        {...attributes}
        {...listeners}
        className={`relative w-9 h-9 rounded-full cursor-grab active:cursor-grabbing ring-2 transition-all ${isSelected ? 'ring-primary' : 'ring-background'}`}
        title={approval.approverName ?? ''}
      >
        {approval.approverAvatarUrl ? (
          <img
            src={approval.approverAvatarUrl}
            alt={approval.approverName ?? ''}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          <div className="w-full h-full rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
            {(approval.approverName ?? '?').charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      {(hovered || isSelected) && (
        <button
          className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-white rounded-full flex items-center justify-center z-10 hover:scale-110 transition-transform"
          onClick={e => { e.stopPropagation(); onRemove(approval.id); }}
          title="Remover aprovador"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

export function ApprovalSection({
  workspaceId,
  taskId,
  mapId,
  members,
}: {
  workspaceId: string;
  taskId: string;
  mapId?: string | null;
  members: WorkspaceMemberResponse[] | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const approvalsKey = [`/api/workspaces/${workspaceId}/tasks/${taskId}/approvals`];
  const invalidateMap = () => {
    if (mapId) queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
  };

  const { data: approvalsData, isLoading } = useQuery<{ approvalMode: string; approvals: ApprovalItem[] }>({
    queryKey: approvalsKey,
    queryFn: () => customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/approvals`),
    enabled: !!workspaceId && !!taskId,
  });

  const approvals = approvalsData?.approvals ?? [];
  const approvalMode = approvalsData?.approvalMode ?? "sequential";

  const addApproverMut = useMutation({
    mutationFn: (approverId: string) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/approvals`, {
        method: "POST",
        body: JSON.stringify({ approverId }),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: approvalsKey }); invalidateMap(); },
    onError: () => toast({ title: "Erro ao adicionar aprovador", variant: "destructive" }),
  });

  const removeApproverMut = useMutation({
    mutationFn: (approvalTaskId: string) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/approvals/${approvalTaskId}`, {
        method: "DELETE",
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: approvalsKey }); invalidateMap(); },
    onError: () => toast({ title: "Erro ao remover aprovador", variant: "destructive" }),
  });

  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/approvals/reorder`, {
        method: "PUT",
        body: JSON.stringify({ orderedIds }),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: approvalsKey }); invalidateMap(); },
  });

  const patchModeMut = useMutation({
    mutationFn: (mode: string) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/approval-mode`, {
        method: "PATCH",
        body: JSON.stringify({ approvalMode: mode }),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: approvalsKey }); invalidateMap(); },
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = approvals.findIndex(a => a.id === active.id);
      const newIndex = approvals.findIndex(a => a.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(approvals, oldIndex, newIndex);
      reorderMut.mutate(reordered.map(a => a.id));
    }
  }, [approvals, reorderMut]);

  const alreadySelectedUserIds = new Set(approvals.map(a => a.assignedTo).filter(Boolean));
  const availableMembers = members?.filter(m => !alreadySelectedUserIds.has(m.userId)) ?? [];

  useEffect(() => {
    if (!showUserMenu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showUserMenu]);

  if (isLoading) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {approvals.length < MAX_APPROVERS && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowUserMenu(v => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-muted"
              title="Adicionar aprovador"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="lowercase">aprovações +</span>
            </button>
            {showUserMenu && (
              <div className="absolute top-8 left-0 z-50 bg-popover border border-border rounded-xl shadow-lg min-w-[200px] py-1.5 overflow-hidden">
                {availableMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-2 lowercase">Sem membros disponíveis</p>
                ) : (
                  availableMembers.map(m => (
                    <button
                      key={m.userId}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 text-left transition-colors"
                      onClick={() => {
                        addApproverMut.mutate(m.userId);
                        setShowUserMenu(false);
                      }}
                    >
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center overflow-hidden">
                        {m.user.avatarUrl ? (
                          <img src={m.user.avatarUrl} alt={m.user.name} className="w-full h-full object-cover rounded-full" />
                        ) : (
                          <span className="text-xs font-semibold text-primary">{m.user.name.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <span className="text-sm text-foreground">{m.user.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {approvals.length > 0 && (
        <div className="flex flex-col gap-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={approvals.map(a => a.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex items-center gap-2 flex-wrap">
                {approvals.map(approval => (
                  <SortableApproverAvatar
                    key={approval.id}
                    approval={approval}
                    onRemove={(id) => removeApproverMut.mutate(id)}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {approvals.length >= 2 && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground lowercase">modo:</span>
              <button
                onClick={() => patchModeMut.mutate("sequential")}
                className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all lowercase ${
                  approvalMode === "sequential"
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-muted-foreground border-border hover:border-foreground/40"
                }`}
              >
                sequencial
              </button>
              <button
                onClick={() => patchModeMut.mutate("parallel")}
                className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all lowercase ${
                  approvalMode === "parallel"
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-muted-foreground border-border hover:border-foreground/40"
                }`}
              >
                paralelo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
