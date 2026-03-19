import { Router, IRouter } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { users, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, signToken, AuthRequest } from "../middlewares/auth";
import { z } from "zod";

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

router.post("/register", async (req, res) => {
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

  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
    token,
  });
});

router.post("/login", async (req, res) => {
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

  res.json({
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
    token,
  });
});

router.post("/logout", (_req, res) => {
  res.json({ success: true, message: "Logged out" });
});

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

  res.json({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt });
});

const updateMeSchema = z.object({
  name: z.string().min(1).max(100),
});

router.patch("/me", requireAuth, async (req: AuthRequest, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(users)
    .set({ name: parsed.data.name })
    .where(eq(users.id, req.user!.userId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found", message: "User not found" });
    return;
  }

  res.json({ id: updated.id, name: updated.name, email: updated.email, createdAt: updated.createdAt });
});

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
