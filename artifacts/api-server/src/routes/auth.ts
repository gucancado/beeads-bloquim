import { randomUUID } from "node:crypto";
import { Router, IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { users, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, signToken, AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { loginLimiter, registerLimiter } from "../middlewares/rateLimit";
import { z } from "zod";
import {
  sanitizeFilename,
  validateFileUpload,
} from "@workspace/storage";
import { getStorage } from "../lib/storage";
import { requireStorage } from "../lib/featureFlags";
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  clearAuthCookieOptions,
} from "../lib/cookies";

const log = logger.child({ module: "auth" });
const router: IRouter = Router();


const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/register", registerLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { name, email, password } = parsed.data;

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Conflict", message: "Email already in use" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(users).values({ name, email, passwordHash }).returning();

  const token = signToken({ userId: user.id, email: user.email });

  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);

  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
});

router.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
    return;
  }

  const token = signToken({ userId: user.id, email: user.email });

  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);

  res.json({
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions);
  res.json({ success: true, message: "Logged out" });
});

function avatarUrlFor(user: { id: string; avatarStoragePath: string | null }): string | null {
  return user.avatarStoragePath ? `/api/users/${user.id}/avatar` : null;
}

/**
 * Avatar URL stored in `users.avatar_url` is denormalised from
 * `avatar_storage_path` so legacy SELECTs that read `users.avatarUrl` keep
 * working. Whenever the storage path changes, this must be kept in sync.
 */
function denormalisedAvatarUrl(userId: string, storagePath: string | null): string | null {
  return storagePath ? `/api/users/${userId}/avatar` : null;
}

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, req.user!.userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "Not found", message: "User not found" });
    return;
  }

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    avatarUrl: avatarUrlFor(user),
    whatsapp: user.whatsapp,
    classes: user.classes,
    pronouns: user.pronouns,
  });
});

const USER_CLASS_ENUM = [
  "gerente_contas",
  "gestor_trafego",
  "gestor_midias_sociais",
  "analista_dados",
  "designer",
  "tecnico",
] as const;

const updateMeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  /** Set to null to clear the avatar. To set/replace, use POST /me/avatar/upload-url first. */
  avatarUrl: z.literal(null).optional(),
  whatsapp: z.string().trim().max(30).nullable().optional(),
  classes: z.array(z.enum(USER_CLASS_ENUM)).max(20).optional(),
  pronouns: z.enum(["name_only", "ela_dela", "ele_dele", "elu_delu"]).optional(),
});

router.patch("/me", requireAuth, async (req: AuthRequest, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.avatarUrl === null) {
    updates.avatarStoragePath = null;
    updates.avatarUrl = null;
  }
  if (parsed.data.whatsapp !== undefined) {
    updates.whatsapp = parsed.data.whatsapp === "" ? null : parsed.data.whatsapp;
  }
  if (parsed.data.classes !== undefined) updates.classes = parsed.data.classes;
  if (parsed.data.pronouns !== undefined) updates.pronouns = parsed.data.pronouns;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Validation error", message: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, req.user!.userId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found", message: "User not found" });
    return;
  }

  res.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    createdAt: updated.createdAt,
    avatarUrl: avatarUrlFor(updated),
    whatsapp: updated.whatsapp,
    classes: updated.classes,
    pronouns: updated.pronouns,
  });
});

// ---------------------------------------------------------------------------
// Avatar upload — issues a presigned URL on the `avatars` bucket and updates
// the user's `avatar_storage_path` to the new path. Frontend reads the avatar
// via GET /api/users/:userId/avatar (proxied stream).
// ---------------------------------------------------------------------------

const avatarUploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().regex(/^image\//, "contentType must be an image/* MIME type"),
  sizeBytes: z.number().int().positive(),
});

router.post(
  "/me/avatar/upload-url",
  requireAuth,
  requireStorage,
  async (req: AuthRequest, res) => {
    const parsed = avatarUploadUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_failed", details: parsed.error.issues });
      return;
    }
    const { filename, contentType, sizeBytes } = parsed.data;
    // Avatars are capped tighter than generic attachments — 5 MB.
    const validation = validateFileUpload({
      filename,
      mimeType: contentType,
      sizeBytes,
      maxSizeBytes: 5 * 1024 * 1024,
    });
    if (validation) {
      res.status(400).json({ error: validation.code, message: validation.message });
      return;
    }

    const userId = req.user!.userId;
    const safeName = sanitizeFilename(filename);
    const objectId = randomUUID();
    const storagePath = `user/${userId}/avatar/${objectId}-${safeName}`;

    const storage = getStorage();
    let signed;
    try {
      signed = await storage.createUploadUrl({
        bucket: "avatars",
        storagePath,
        contentType,
      });
    } catch (err) {
      log.error({ err, storagePath }, "createUploadUrl failed for avatar");
      res.status(502).json({ error: "storage_error" });
      return;
    }

    // Persist the new path immediately. If the client never PUTs the file the
    // user effectively has a broken avatar — but no worse than before, and a
    // future GC job can reconcile orphan paths against bucket contents.
    const newAvatarUrl = denormalisedAvatarUrl(userId, storagePath);
    const [updated] = await db
      .update(users)
      .set({ avatarStoragePath: storagePath, avatarUrl: newAvatarUrl })
      .where(eq(users.id, userId))
      .returning();

    res.status(201).json({
      uploadUrl: signed.uploadUrl,
      method: signed.method,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
      avatarUrl: avatarUrlFor(updated),
    });
  },
);

router.get("/me/workspaces", requireAuth, async (req: AuthRequest, res) => {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      hidden: workspaces.hidden,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, req.user!.userId));

  res.json(rows);
});

export default router;
