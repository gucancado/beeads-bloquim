import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { requireStorage } from "../lib/featureFlags";
import { getStorage } from "../lib/storage";
import { logger } from "../lib/logger";

const log = logger.child({ module: "users" });
const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/users/:userId/avatar
//
// Backend-proxied avatar stream. Any authenticated user may fetch any other
// user's avatar (e.g. to render team-member lists). The file lives in the
// `avatars` bucket; the user table holds only the storage path.
// ---------------------------------------------------------------------------

router.get(
  "/:userId/avatar",
  requireAuth,
  requireStorage,
  async (req: AuthRequest, res) => {
    const { userId } = req.params;

    const [row] = await db
      .select({ avatarStoragePath: users.avatarStoragePath })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row || !row.avatarStoragePath) {
      res.status(404).json({ error: "no_avatar" });
      return;
    }

    const storage = getStorage();
    let stream;
    try {
      stream = await storage.getReadStream({
        bucket: "avatars",
        storagePath: row.avatarStoragePath,
      });
    } catch (err) {
      log.warn({ err, userId }, "avatar getReadStream failed");
      res.status(404).json({ error: "no_avatar" });
      return;
    }

    res.setHeader("Content-Type", stream.contentType || "image/*");
    if (stream.contentLength !== undefined) {
      res.setHeader("Content-Length", String(stream.contentLength));
    }
    // Avatars rarely change; cache privately for 5 minutes so subsequent
    // renders within the same session reuse the response.
    res.setHeader("Cache-Control", "private, max-age=300");
    stream.stream.pipe(res);
  },
);

export default router;
