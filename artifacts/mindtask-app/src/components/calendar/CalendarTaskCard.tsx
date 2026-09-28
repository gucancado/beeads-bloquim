import TaskCardBody, { type TaskCardData } from "@/components/maps/TaskCardBody";
import type { AvatarPickerMember } from "@/components/tasks/AssigneeAvatarPicker";
import { useInlineTaskEditor } from "@/hooks/useInlineTaskEditor";
import { getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import type { CalendarTask } from "@/lib/calendar/placement";

export function toTaskCardData(t: CalendarTask): TaskCardData {
  const overdueVisual = !!t.overdue && (t.status === "pending" || t.status === "in_progress");
  return {
    title: getApprovalDisplayTitle(t),
    statusVisual: overdueVisual ? "overdue" : t.status,
    taskId: t.id,
    taskDueDate: t.dueDate ?? null,
    taskStartAt: t.startAt ?? null,
    taskScheduleMode: t.scheduleMode ?? "sem_prazo",
    taskAssigneeName: t.assigneeName ?? null,
    taskAssigneeId: t.assignedTo ?? null,
    taskAssigneeAvatarUrl: t.assigneeAvatarUrl ?? null,
    taskDescription: t.description ?? null,
    taskCompletedAt: t.completedAt ?? null,
    taskParentApprovalStatus: t.parentApprovalStatus ?? null,
    taskAttachmentCount: t.attachmentCount ?? null,
    taskSubtaskCount: t.subtaskCount ?? null,
    taskSubtaskCompletedCount: t.subtaskCompletedCount ?? null,
    taskCommentCount: t.commentCount ?? null,
  };
}

export function CalendarTaskCard({ task, members, invalidateKeys, onOpen }: {
  task: CalendarTask;
  members: AvatarPickerMember[];
  invalidateKeys: unknown[][];
  onOpen: (task: CalendarTask) => void;
}) {
  const editor = useInlineTaskEditor({ task, invalidateQueryKeys: invalidateKeys });
  const t = editor.localTask;
  return (
    <TaskCardBody
      data={toTaskCardData(t)}
      width="fill"
      members={members}
      onTitleSave={(next) => {
        editor.setLocalTask(p => ({ ...p, title: next, cardTitle: p.cardTitle ? next : p.cardTitle }));
        void editor.saveTitle(next);
      }}
      onStatusChange={(status) => {
        editor.setLocalTask(p => ({ ...p, status }));
        void editor.patchStatus(status);
      }}
      onAssigneeChange={(userId) => {
        const assignedTo = userId === "unassigned" ? null : userId;
        const m = members.find(x => x.userId === userId);
        editor.setLocalTask(p => ({
          ...p, assignedTo, assigneeName: m?.user.name ?? null, assigneeAvatarUrl: m?.user.avatarUrl ?? null,
        }));
        void editor.patchTask({ assignedTo });
      }}
      onSchedulePatch={(patch) => {
        editor.setLocalTask(p => ({ ...p, ...patch }));
        void editor.patchTask(patch);
      }}
      onScheduleEditingChange={editor.handleScheduleOpenChange}
      onOpen={() => onOpen(task)}
    />
  );
}
