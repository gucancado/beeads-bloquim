import type { ReactNode } from "react";

interface ApprovalTaskLike {
  isApprovalTask?: boolean | null;
  parentTaskTitle?: string | null;
  parentTask?: { title?: string | null } | null;
  title?: string | null;
  cardTitle?: string | null;
}

/**
 * Returns the title that should be displayed for an approval task.
 *
 * Approval tasks store `title` in the database as `"aprovação: <parent title>"`,
 * which de-syncs whenever the parent is renamed. We never render that stored
 * title — instead we always show the parent task's current title. Callers must
 * supply either `parentTaskTitle` (preferred, set by listing endpoints) or a
 * loaded `parentTask.title`. As a final safety net we strip the legacy
 * `aprovação: ` prefix from the stored title.
 *
 * For non-approval tasks the function falls back to the regular display title
 * (cardTitle when linked, otherwise title), so callers can use it
 * unconditionally.
 */
export const APPROVAL_TITLE_FALLBACK = "tarefa sem título";

export function getApprovalDisplayTitle(task: ApprovalTaskLike): string {
  if (!task.isApprovalTask) {
    const t = task.cardTitle ?? task.title ?? "";
    return t.length > 0 ? t : APPROVAL_TITLE_FALLBACK;
  }
  const parentTitle = task.parentTaskTitle ?? task.parentTask?.title ?? null;
  if (parentTitle && parentTitle.length > 0) return parentTitle;
  const stored = task.cardTitle ?? task.title ?? "";
  const stripped = stored.replace(/^\s*aprovação:\s*/i, "").trim();
  return stripped.length > 0 ? stripped : APPROVAL_TITLE_FALLBACK;
}

interface ApprovalBadgeProps {
  className?: string;
  children?: ReactNode;
}

/**
 * Standard "aprovação" badge used wherever an approval task title is shown.
 * Visual matches the badge currently used in `TaskListItem`.
 */
export function ApprovalBadge({ className, children }: ApprovalBadgeProps) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 text-[10px] font-semibold text-violet-600 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/50 px-2 py-0.5 rounded-full tracking-wide lowercase shrink-0 " +
        (className ?? "")
      }
    >
      {children ?? "aprovação"}
    </span>
  );
}
