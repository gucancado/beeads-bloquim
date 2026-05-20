import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import {
  taskBelongsToWorkspace,
} from "../services/taskAttachmentsService";
import {
  TaskLinkError,
  createTaskLink,
  removeTaskLink,
  listTaskLinks,
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

const createLinkBody = z.object({
  targetTaskId: z.string().regex(UUID_REGEX),
});

const kindBody = z.object({
  kind: z.enum(["standard", "deliverable"]),
});

/**
 * D9: any workspace member (admin/editor/executor) can create or remove
 * task links. Permission is enforced at this router-level middleware so we
 * don't repeat the role list on every route.
 */
const memberOnly = requireWorkspaceRole(["admin", "editor", "executor"]);

function handleLinkError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof TaskLinkError) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

/**
 * Lightweight filename lookup for activity metadata. Returns null if the row
 * has been hard-deleted (which would be unusual for an alive task link).
 */
async function attachmentFilename(attachmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: attachments.originalFilename })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  return row?.name ?? null;
}

// ── Task links ──────────────────────────────────────────────────────────────

router.get("/links", requireAuth, memberOnly, async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params as {
    workspaceId: string;
    taskId: string;
  };
  if (!UUID_REGEX.test(taskId)) {
    res.status(400).json({ error: "Bad Request", message: "invalid taskId" });
    return;
  }
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not Found" });
    return;
  }
  const { outgoing, incoming } = await listTaskLinks(taskId);
  res.json({ outgoing, incoming });
});

router.post("/links", requireAuth, memberOnly, async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params as {
    workspaceId: string;
    taskId: string;
  };
  if (!UUID_REGEX.test(taskId)) {
    res.status(400).json({ error: "Bad Request", message: "invalid taskId" });
    return;
  }
  const parsed = createLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not Found" });
    return;
  }
  const { targetTaskId } = parsed.data;
  const userId = req.user!.userId;

  try {
    const { link, inheritedCount } = await createTaskLink(
      taskId,
      targetTaskId,
      userId,
    );
    // Activity on both endpoints (audit symmetry — spec §9).
    await Promise.all([
      recordTaskActivity({
        taskId,
        actorId: userId,
        type: "task_link_created",
        metadata: {
          otherTaskId: targetTaskId,
          direction: "outgoing",
          inheritedCount: String(inheritedCount),
        },
      }),
      recordTaskActivity({
        taskId: targetTaskId,
        actorId: userId,
        type: "task_link_created",
        metadata: {
          otherTaskId: taskId,
          direction: "incoming",
          inheritedCount: String(inheritedCount),
        },
      }),
    ]);
    res.status(201).json({ link, inheritedCount });
  } catch (err) {
    if (handleLinkError(err, res)) return;
    throw err;
  }
});

router.delete(
  "/links/:linkId",
  requireAuth,
  memberOnly,
  async (req: AuthRequest, res) => {
    const { workspaceId, taskId, linkId } = req.params as {
      workspaceId: string;
      taskId: string;
      linkId: string;
    };
    if (!UUID_REGEX.test(taskId) || !UUID_REGEX.test(linkId)) {
      res.status(400).json({ error: "Bad Request", message: "invalid id" });
      return;
    }
    if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    const userId = req.user!.userId;

    try {
      const result = await removeTaskLink(linkId);
      if (!result) {
        res.status(404).json({ error: "Link not found" });
        return;
      }
      // Only audit when the caller is one of the endpoints — defensive check
      // since URL is namespaced under :taskId, but link could be foreign.
      const { link, removedAttachmentCount } = result;
      if (link.sourceTaskId !== taskId && link.targetTaskId !== taskId) {
        res.status(403).json({
          error: "Forbidden",
          message: "Link não pertence a esta tarefa.",
        });
        return;
      }
      await Promise.all([
        recordTaskActivity({
          taskId: link.sourceTaskId,
          actorId: userId,
          type: "task_link_removed",
          metadata: {
            otherTaskId: link.targetTaskId,
            direction: "outgoing",
            removedAttachmentCount: String(removedAttachmentCount),
          },
        }),
        recordTaskActivity({
          taskId: link.targetTaskId,
          actorId: userId,
          type: "task_link_removed",
          metadata: {
            otherTaskId: link.sourceTaskId,
            direction: "incoming",
            removedAttachmentCount: String(removedAttachmentCount),
          },
        }),
      ]);
      res.status(200).json({ removedAttachmentCount });
    } catch (err) {
      if (handleLinkError(err, res)) return;
      throw err;
    }
  },
);

// ── Attachment ops (inheritance side) ───────────────────────────────────────

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
        const { propagatedToCount } = await promoteAttachmentInTask(
          taskId,
          attachmentId,
          userId,
        );
        await recordTaskActivity({
          taskId,
          actorId: userId,
          type: "attachment_promoted",
          metadata: {
            attachmentId,
            filename,
            propagatedToCount: String(propagatedToCount),
          },
        });
        res.json({ kind: "deliverable", propagatedToCount });
      } else {
        const { removedFromCount } = await demoteAttachmentInTask(
          taskId,
          attachmentId,
        );
        await recordTaskActivity({
          taskId,
          actorId: userId,
          type: "attachment_demoted",
          metadata: {
            attachmentId,
            filename,
            removedFromCount: String(removedFromCount),
          },
        });
        res.json({ kind: "standard", removedFromCount });
      }
    } catch (err) {
      if (handleLinkError(err, res)) return;
      throw err;
    }
  },
);

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

    const { removed, downstreamRemovedCount } = await unlinkAttachmentFromTask(
      taskId,
      attachmentId,
    );
    if (!removed) {
      res.status(404).json({ error: "Attachment not linked to task" });
      return;
    }
    await recordTaskActivity({
      taskId,
      actorId: userId,
      type: "attachment_unlinked",
      metadata: {
        attachmentId,
        filename,
        downstreamRemovedCount: String(downstreamRemovedCount),
      },
    });
    res.status(200).json({ downstreamRemovedCount });
  },
);

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
