import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { taskBelongsToWorkspace } from "../services/taskAttachmentsService";
import {
  TaskLinkError,
  promoteAttachmentInTask,
  demoteAttachmentInTask,
  unlinkAttachmentFromTask,
  getAttachmentUsageCount,
} from "../services/taskLinksService";
import { recordTaskActivity } from "../services/taskActivitiesService";
import { db } from "@workspace/db";
import { attachments } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const kindBody = z.object({
  kind: z.enum(["standard", "deliverable"]),
});

const memberOnly = requireWorkspaceRole(["admin", "editor", "executor"]);

function handleLinkError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof TaskLinkError) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

async function attachmentFilename(attachmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: attachments.originalFilename })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  return row?.name ?? null;
}

// ── Attachment per-task kind (promote/demote, inheritance-aware) ────────────

router.patch(
  "/attachments/:attachmentId/kind",
  requireAuth,
  memberOnly,
  async (req: AuthRequest, res) => {
    const { workspaceId, taskId, attachmentId } = req.params as {
      workspaceId: string;
      taskId: string;
      attachmentId: string;
    };
    if (!UUID_REGEX.test(taskId) || !UUID_REGEX.test(attachmentId)) {
      res.status(400).json({ error: "Bad Request", message: "invalid id" });
      return;
    }
    const parsed = kindBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }
    if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    const userId = req.user!.userId;
    const filename = await attachmentFilename(attachmentId);

    try {
      if (parsed.data.kind === "deliverable") {
        await promoteAttachmentInTask(taskId, attachmentId, userId);
        await recordTaskActivity({
          taskId,
          actorId: userId,
          type: "attachment_promoted",
          metadata: { attachmentId, filename },
        });
        res.json({ kind: "deliverable" });
      } else {
        const result = await demoteAttachmentInTask(taskId, attachmentId);
        if (!result) {
          res.status(404).json({ error: "Attachment not linked to task" });
          return;
        }
        await recordTaskActivity({
          taskId,
          actorId: userId,
          type: "attachment_demoted",
          metadata: { attachmentId, filename },
        });
        res.json({ kind: "standard" });
      }
    } catch (err) {
      if (handleLinkError(err, res)) return;
      throw err;
    }
  },
);

// ── Unlink (remove the per-task row without deleting the file) ──────────────

router.delete(
  "/attachments/:attachmentId/link",
  requireAuth,
  memberOnly,
  async (req: AuthRequest, res) => {
    const { workspaceId, taskId, attachmentId } = req.params as {
      workspaceId: string;
      taskId: string;
      attachmentId: string;
    };
    if (!UUID_REGEX.test(taskId) || !UUID_REGEX.test(attachmentId)) {
      res.status(400).json({ error: "Bad Request", message: "invalid id" });
      return;
    }
    if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    const userId = req.user!.userId;
    const filename = await attachmentFilename(attachmentId);

    const { removed } = await unlinkAttachmentFromTask(taskId, attachmentId);
    if (!removed) {
      res.status(404).json({ error: "Attachment not linked to task" });
      return;
    }
    await recordTaskActivity({
      taskId,
      actorId: userId,
      type: "attachment_unlinked",
      metadata: { attachmentId, filename },
    });
    res.status(200).json({ ok: true });
  },
);

// ── Usage (for the delete-confirm modal) ────────────────────────────────────

router.get(
  "/attachments/:attachmentId/usage",
  requireAuth,
  memberOnly,
  async (req: AuthRequest, res) => {
    const { workspaceId, taskId, attachmentId } = req.params as {
      workspaceId: string;
      taskId: string;
      attachmentId: string;
    };
    if (!UUID_REGEX.test(taskId) || !UUID_REGEX.test(attachmentId)) {
      res.status(400).json({ error: "Bad Request", message: "invalid id" });
      return;
    }
    if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    const { taskCount, taskIds } = await getAttachmentUsageCount(attachmentId);
    res.json({ taskCount, taskIds });
  },
);

export default router;
