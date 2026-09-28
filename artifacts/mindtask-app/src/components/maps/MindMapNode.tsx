import { memo, useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateCard, useUpdateTaskStatus, useUpdateTaskDetails, useListWorkspaceMembers } from '@workspace/api-client-react';
import TaskCardBody, { getNodeColors, type SchedulePatch, type ScheduleModeValue, type TaskCardData } from './TaskCardBody';

interface MindMapNodeProps {
  id: string;
  data: TaskCardData & {
    workspaceId?: string;
    mapId?: string;
    onOpen?: (id: string) => void;
    onAddChild?: (id: string) => void;
    onInlineUpdate?: (cardId: string, patch: Partial<{
      title: string;
      statusVisual: string;
      taskAssigneeName: string | null;
      taskAssigneeId: string | null;
      taskAssigneeAvatarUrl: string | null;
      taskDueDate: string | null;
      taskStartAt: string | null;
      taskScheduleMode: ScheduleModeValue | null;
    }>) => void;
    onEditingChange?: (cardId: string, isEditing: boolean) => void;
    onAutoFocusDone?: (cardId: string) => void;
    isTerminalNode?: boolean;
    autoFocusTitle?: boolean;
  };
  selected: boolean;
}

function toNodePatch(p: SchedulePatch) {
  const out: { taskDueDate?: string | null; taskStartAt?: string | null; taskScheduleMode?: ScheduleModeValue } = {};
  if ('dueDate' in p) out.taskDueDate = p.dueDate ?? null;
  if ('startAt' in p) out.taskStartAt = p.startAt ?? null;
  if (p.scheduleMode !== undefined) out.taskScheduleMode = p.scheduleMode;
  return out;
}

function MindMapNode({ id, data, selected }: MindMapNodeProps) {
  const workspaceId = data.workspaceId ?? '';
  const mapId = data.mapId ?? '';
  const hasTask = !!data.taskId;
  const isTerminalNode = data.isTerminalNode !== false;
  const nodeColors = getNodeColors(data.statusVisual);

  const queryClient = useQueryClient();
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${id}`] });
    if (data.taskId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${data.taskId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
      queryClient.invalidateQueries({ queryKey: [`task-activities`, workspaceId, data.taskId] });
    }
  }, [queryClient, workspaceId, mapId, id, data.taskId]);

  const updateCardMut = useUpdateCard();
  const updateTaskStatusMut = useUpdateTaskStatus();
  const updateTaskDetailsMut = useUpdateTaskDetails();
  const { data: members } = useListWorkspaceMembers(workspaceId, { query: { enabled: !!workspaceId && hasTask } });

  const handleTitleSave = (next: string) => {
    data.onInlineUpdate?.(id, { title: next });
    updateCardMut.mutate({ workspaceId, mapId, cardId: id, data: { title: next } }, { onSuccess: invalidateAll });
  };
  const handleStatusChange = (status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'draft') => {
    data.onInlineUpdate?.(id, { statusVisual: status });
    if (data.taskId) {
      updateTaskStatusMut.mutate({ workspaceId, mapId, cardId: id, data: { status } }, { onSuccess: invalidateAll });
    }
  };
  const handleAssigneeChange = (userId: string) => {
    if (userId === 'unassigned') {
      data.onInlineUpdate?.(id, { taskAssigneeName: null, taskAssigneeId: null, taskAssigneeAvatarUrl: null });
      if (data.taskId) {
        updateTaskDetailsMut.mutate({ workspaceId, mapId, cardId: id, data: { assignedTo: null } }, { onSuccess: invalidateAll });
      }
      return;
    }
    const member = members?.find(m => m.userId === userId);
    if (!member) return;
    data.onInlineUpdate?.(id, {
      taskAssigneeName: member.user.name,
      taskAssigneeId: userId,
      taskAssigneeAvatarUrl: member.user.avatarUrl ?? null,
    });
    if (data.taskId) {
      updateTaskDetailsMut.mutate({ workspaceId, mapId, cardId: id, data: { assignedTo: userId } }, { onSuccess: invalidateAll });
    }
  };
  const handleSchedulePatch = (p: SchedulePatch) => {
    data.onInlineUpdate?.(id, toNodePatch(p));
    if (data.taskId) {
      updateTaskDetailsMut.mutate({ workspaceId, mapId, cardId: id, data: p }, { onSuccess: invalidateAll });
    }
  };

  return (
    <TaskCardBody
      data={data}
      selected={selected}
      members={members}
      autoFocusTitle={data.autoFocusTitle}
      onAutoFocusConsumed={() => data.onAutoFocusDone?.(id)}
      onTitleSave={handleTitleSave}
      onEditingChange={(editing) => data.onEditingChange?.(id, editing)}
      onStatusChange={handleStatusChange}
      onAssigneeChange={handleAssigneeChange}
      onSchedulePatch={handleSchedulePatch}
      onOpen={() => data.onOpen?.(id)}
    >
      {isTerminalNode && (
        <div
          className="nodrag nopan absolute hover:scale-110 transition-transform duration-150"
          style={{ right: '-4rem', top: 'calc(50% - 24px)' }}
        >
          {/* Visual circle — pointer-events-none so the Handle underneath captures events */}
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-opacity duration-150 shadow-lg pointer-events-none"
            style={{ backgroundColor: nodeColors.hex, color: '#fff' }}
          >
            <Plus className="w-6 h-6" />
          </div>
          {/* Transparent source Handle covering the full button area */}
          <Handle
            type="source"
            position={Position.Right}
            id="plus-right"
            className="!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer"
            isConnectable
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); data.onAddChild?.(id); }}
          />
        </div>
      )}
      {/* Invisible handles for edge anchoring only — no interaction */}
      <Handle type="target" position={Position.Left} id="target-left" className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1" />
      <Handle type="source" position={Position.Right} id="source-right" className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1" />
    </TaskCardBody>
  );
}

export default memo(MindMapNode);
