import ApprovalCardBody from "@/components/maps/ApprovalCardBody";
import { getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import type { CalendarTask } from "@/lib/calendar/placement";

export function CalendarApprovalCard({ task, onOpen }: { task: CalendarTask; onOpen: (task: CalendarTask) => void }) {
  const overdueVisual = !!task.overdue && (task.status === "pending" || task.status === "in_progress");
  return (
    <ApprovalCardBody
      width="fill"
      data={{
        approverName: task.assigneeName ?? null,
        approverAvatarUrl: task.assigneeAvatarUrl ?? null,
        approvalStatus: overdueVisual ? "overdue" : task.status,
        approvalDecision: task.approvalStatus ?? null,
        dueDate: task.dueDate ?? null,
        taskTitle: getApprovalDisplayTitle(task),
      }}
      onOpen={() => onOpen(task)}
    />
  );
}
