import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import {
  cards,
  cardConnections,
  mapShapes,
  mapTextElements,
  planTemplates,
  subtasks,
  taskActivities,
  tasks,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { NODE_WIDTH } from "../lib/collision";

type ApplyBody = {
  cardIds: string[];
  connectionIds: string[];
  textElementIds: string[];
  shapeIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
};

async function mapCounts(mapId: string) {
  const cardRows = await db.select({ id: cards.id }).from(cards).where(eq(cards.mapId, mapId));
  const taskRows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.mapId, mapId));
  const acts = taskRows.length
    ? await db.select({ id: taskActivities.id }).from(taskActivities).where(inArray(taskActivities.taskId, taskRows.map((t) => t.id)))
    : [];
  const conns = await db.select({ id: cardConnections.id }).from(cardConnections).where(eq(cardConnections.mapId, mapId));
  return { cards: cardRows.length, tasks: taskRows.length, activities: acts.length, connections: conns.length };
}

describe("modelos de plano de ação", () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let admin: Agent;
  let adminId: string;
  let executor: Agent;
  let executorId: string;
  let workspaceId: string;
  let mapId: string;
  let mapName: string;
  let emptyMapId: string;
  let otherMapId: string; // mapa de OUTRO workspace
  let alphaCardId: string;
  let approvalCardId: string;
  let fullTemplateId: string;

  beforeAll(async () => {
    const a = await registerAndLogin("Admin");
    admin = a.agent; adminId = a.user.id; userIds.push(adminId);
    const e = await registerAndLogin("Executor");
    executor = e.agent; executorId = e.user.id; userIds.push(executorId);
    const ap = await registerAndLogin("Aprovador");
    userIds.push(ap.user.id);

    const ws = await admin.post("/api/workspaces").send({ name: "Plan Tpl WS", colorIndex: 0 });
    workspaceId = ws.body.id; workspaceIds.push(workspaceId);
    await admin.post(`/api/workspaces/${workspaceId}/members`).send({ email: e.user.email, role: "executor" });
    await admin.post(`/api/workspaces/${workspaceId}/members`).send({ email: ap.user.email, role: "editor" });

    mapName = "Lançamento";
    mapId = (await admin.post(`/api/workspaces/${workspaceId}/maps`).send({ name: mapName })).body.id;
    emptyMapId = (await admin.post(`/api/workspaces/${workspaceId}/maps`).send({ name: "Vazio" })).body.id;

    const ws2 = await ap.agent.post("/api/workspaces").send({ name: "Outro WS", colorIndex: 1 });
    workspaceIds.push(ws2.body.id);
    otherMapId = (await ap.agent.post(`/api/workspaces/${ws2.body.id}/maps`).send({ name: "Outro" })).body.id;

    const base = `/api/workspaces/${workspaceId}/maps/${mapId}`;
    const alpha = await admin.post(`${base}/cards`).send({ title: "alpha", positionX: 0, positionY: 0 });
    const beta = await admin.post(`${base}/cards`).send({ title: "beta", positionX: 600, positionY: 0 });
    alphaCardId = alpha.body.id;
    const alphaTask = alpha.body.taskId as string;
    await admin.patch(`/api/workspaces/${workspaceId}/tasks/${alphaTask}`).send({ description: "desc a", priority: "high" });
    await admin.put(`/api/workspaces/${workspaceId}/tasks/${alphaTask}/subtasks`).send({
      subtasks: [
        { text: "um", completed: true, order: 0 },
        { text: "dois", completed: false, order: 1 },
      ],
    });
    // card legado sem tarefa
    const [legacy] = await db
      .insert(cards)
      .values({ mapId, title: "gamma", positionX: 1200, positionY: 0, statusVisual: "no_task" })
      .returning();
    await admin.post(`${base}/connections`).send({
      sourceCardId: alpha.body.id, targetCardId: beta.body.id, sourceHandle: "source-right", targetHandle: "target-left",
    });
    // aprovação em beta; conexão aprovação → gamma (deve virar beta → gamma)
    const apRes = await admin
      .post(`/api/workspaces/${workspaceId}/tasks/${beta.body.taskId}/approvals`)
      .send({ approverId: ap.user.id, dueDate: null });
    expect(apRes.status).toBe(201);
    const [apCard] = await db.select({ id: cards.id }).from(cards).where(eq(cards.taskId, apRes.body.id));
    approvalCardId = apCard.id;
    await db.insert(cardConnections).values({
      mapId, sourceCardId: approvalCardId, targetCardId: legacy.id, sourceHandle: "source-right", targetHandle: "target-left",
    }).onConflictDoNothing();
    await admin.post(`${base}/text-elements`).send({ positionX: -100, positionY: 500, content: '{"type":"doc","content":[{"type":"paragraph"}]}' });
    await admin.post(`${base}/shapes`).send({ type: "rect", positionX: 300, positionY: 500, width: 100, height: 50 });
    await db.insert(mapShapes).values({ mapId, type: "image", positionX: 0, positionY: 900, width: 100, height: 100 });
  });

  afterAll(async () => {
    await deleteWorkspaces(workspaceIds);
    for (const id of userIds) await deleteUser(id); // plan_templates cai em cascade
  });

  it("captura o mapa inteiro (aprovação remapeada pro pai, imagem fora)", async () => {
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/capture`).send({});
    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe(mapName);
    expect(res.body.template.counts).toEqual({ cards: 3, connections: 2, texts: 1, shapes: 1 });
    expect(res.body.skipped).toEqual({ approvals: 1, images: 1 });
    fullTemplateId = res.body.template.id;

    const [row] = await db.select().from(planTemplates).where(eq(planTemplates.id, fullTemplateId));
    expect(row.userId).toBe(adminId);
    const p = row.payload as {
      cards: Array<{ key: string; x: number; y: number; title: string; task: { priority: string; checklist: unknown[] } }>;
      connections: Array<{ sourceKey: string; targetKey: string; sourceHandle: string | null }>;
      texts: Array<{ x: number; y: number }>;
      shapes: Array<{ x: number; y: number }>;
    };
    const xs = [...p.cards, ...p.texts, ...p.shapes].map((e) => e.x);
    const ys = [...p.cards, ...p.texts, ...p.shapes].map((e) => e.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    const byTitle = new Map(p.cards.map((c) => [c.title, c]));
    expect(byTitle.get("alpha")!.task.priority).toBe("high");
    expect(byTitle.get("alpha")!.task.checklist).toHaveLength(2);
    expect(byTitle.get("gamma")!.task).toEqual({ priority: "medium", checklist: [] });
    const keyOf = (t: string) => byTitle.get(t)!.key;
    const pairs = p.connections.map((c) => `${c.sourceKey}->${c.targetKey}`).sort();
    expect(pairs).toEqual([`${keyOf("alpha")}->${keyOf("beta")}`, `${keyOf("beta")}->${keyOf("gamma")}`].sort());
  });

  it("corpo ausente equivale a {} (mapa inteiro)", async () => {
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/capture`);
    expect(res.status).toBe(201);
    expect(res.body.template.counts.cards).toBe(3);
  });

  it("captura subconjunto e conta a aprovação selecionada; executor pode capturar", async () => {
    const res = await executor
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/capture`)
      .send({ cardIds: [alphaCardId, approvalCardId], textElementIds: [] });
    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe(`${mapName} (seleção)`);
    expect(res.body.template.counts).toEqual({ cards: 1, connections: 0, texts: 0, shapes: 0 });
    expect(res.body.skipped).toEqual({ approvals: 1, images: 0 });
  });

  it("seleção só com aprovação → 400 com mensagem exibível", async () => {
    const res = await admin
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/capture`)
      .send({ cardIds: [approvalCardId] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("nada pra salvar no modelo");
  });

  it("aplica em mapa vazio na origem, com tarefas draft do caller, checklist e activities", async () => {
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/${fullTemplateId}/apply`);
    expect(res.status).toBe(200);
    const body = res.body as ApplyBody;
    expect(body.cardIds).toHaveLength(3);
    expect(body.connectionIds).toHaveLength(2);
    expect(body.textElementIds).toHaveLength(1);
    expect(body.shapeIds).toHaveLength(1);
    expect(body.bounds.x).toBe(0);
    expect(body.bounds.y).toBe(0);

    const newCards = await db.select().from(cards).where(inArray(cards.id, body.cardIds));
    expect(newCards.every((c) => c.mapId === emptyMapId && c.statusVisual === "draft" && !!c.taskId)).toBe(true);
    const newTasks = await db.select().from(tasks).where(inArray(tasks.id, newCards.map((c) => c.taskId!)));
    for (const t of newTasks) {
      expect(t.status).toBe("draft");
      expect(t.scheduleMode).toBe("sem_prazo");
      expect(t.assignedTo).toBe(adminId);
      expect(t.ownerId).toBe(adminId);
      expect(t.createdBy).toBe(adminId);
      expect(t.workspaceId).toBe(workspaceId);
      expect(t.mapId).toBe(emptyMapId);
    }
    const alphaTask = newTasks.find((t) => t.title === "alpha")!;
    expect(alphaTask.priority).toBe("high");
    expect(alphaTask.description).toBe("desc a");
    const items = await db.select().from(subtasks).where(eq(subtasks.taskId, alphaTask.id));
    expect(items.map((i) => [i.text, i.completed, i.order]).sort()).toEqual([["dois", false, 1], ["um", false, 0]]);
    const acts = await db
      .select()
      .from(taskActivities)
      .where(and(inArray(taskActivities.taskId, newTasks.map((t) => t.id)), eq(taskActivities.type, "task_created")));
    expect(acts).toHaveLength(3);
    expect(acts.every((a) => a.actorId === adminId && a.metadata.actorName === "Admin")).toBe(true);

    const conns = await db.select().from(cardConnections).where(inArray(cardConnections.id, body.connectionIds));
    const ids = new Set(body.cardIds);
    expect(conns.every((c) => ids.has(c.sourceCardId) && ids.has(c.targetCardId))).toBe(true);
    expect(Math.min(...newCards.map((c) => c.positionX))).toBeGreaterThanOrEqual(0);
  });

  it("aplica num mapa com elementos à direita de tudo (maxRight + 120)", async () => {
    const before = {
      cards: await db.select().from(cards).where(eq(cards.mapId, mapId)),
      texts: await db.select().from(mapTextElements).where(eq(mapTextElements.mapId, mapId)),
      shapes: await db.select().from(mapShapes).where(eq(mapShapes.mapId, mapId)),
    };
    const maxRight = Math.max(
      ...before.cards.map((c) => c.positionX + NODE_WIDTH),
      ...before.texts.map((t) => t.positionX + t.width),
      ...before.shapes.map((s) => s.positionX + s.width), // rotação 0 em todas
    );
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/${fullTemplateId}/apply`);
    expect(res.status).toBe(200);
    const body = res.body as ApplyBody;
    expect(body.bounds.x).toBeCloseTo(maxRight + 120, 6);
    const newCards = await db.select().from(cards).where(inArray(cards.id, body.cardIds));
    const newTexts = await db.select().from(mapTextElements).where(inArray(mapTextElements.id, body.textElementIds));
    const newShapes = await db.select().from(mapShapes).where(inArray(mapShapes.id, body.shapeIds));
    for (const x of [...newCards, ...newTexts, ...newShapes].map((e) => e.positionX)) {
      expect(x).toBeGreaterThanOrEqual(maxRight + 120 - 1e-6);
    }
  });

  it("dois applies simultâneos no mesmo mapa não se sobrepõem (lock por mapa)", async () => {
    const lockMapId = (await admin.post(`/api/workspaces/${workspaceId}/maps`).send({ name: "Lock" })).body.id;
    const url = `/api/workspaces/${workspaceId}/maps/${lockMapId}/plan-templates/${fullTemplateId}/apply`;
    const [r1, r2] = await Promise.all([admin.post(url), admin.post(url)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const [first, second] = [r1.body as ApplyBody, r2.body as ApplyBody].sort((a, b) => a.bounds.x - b.bounds.x);
    expect(second.bounds.x).toBeGreaterThanOrEqual(first.bounds.x + first.bounds.width + 120 - 1e-6);
  });

  it("rollback: payload com conexão duplicada falha e não deixa nada no mapa", async () => {
    const [bad] = await db
      .insert(planTemplates)
      .values({
        userId: adminId,
        name: "ruim",
        payload: {
          v: 1,
          cards: [
            { key: "c1", x: 0, y: 0, title: "x", description: null, task: { priority: "low", checklist: [] } },
            { key: "c2", x: 300, y: 0, title: "y", description: null, task: { priority: "low", checklist: [] } },
          ],
          connections: [
            { sourceKey: "c1", targetKey: "c2", sourceHandle: null, targetHandle: null },
            { sourceKey: "c1", targetKey: "c2", sourceHandle: null, targetHandle: null },
          ],
          texts: [],
          shapes: [],
        },
      })
      .returning();
    const before = await mapCounts(mapId);
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/${bad.id}/apply`);
    expect(res.status).toBe(500);
    expect(await mapCounts(mapId)).toEqual(before);
  });

  it("payload fora do schema v1 → 422", async () => {
    const [v2] = await db.insert(planTemplates).values({ userId: adminId, name: "v2", payload: { v: 2 } }).returning();
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/${v2.id}/apply`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("modelo em formato não suportado");
  });

  it("permissões e ids: executor 403, modelo alheio 404, id não-UUID 404, mapa de outro workspace 404", async () => {
    const execApply = await executor.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/${fullTemplateId}/apply`);
    expect(execApply.status).toBe(403);

    const [execTpl] = await db.select({ id: planTemplates.id }).from(planTemplates).where(eq(planTemplates.userId, executorId));
    const foreign = await admin.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/${execTpl.id}/apply`);
    expect(foreign.status).toBe(404);

    const notUuid = await admin.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/not-a-uuid/apply`);
    expect(notUuid.status).toBe(404);

    const otherMap = await admin.post(`/api/workspaces/${workspaceId}/maps/${otherMapId}/plan-templates/${fullTemplateId}/apply`);
    expect(otherMap.status).toBe(404);
  });

  it("gestão: lista sem payload, renomeia, exclui; escopo do dono", async () => {
    const list = await admin.get("/api/plan-templates");
    expect(list.status).toBe(200);
    const item = (list.body as Array<Record<string, unknown>>).find((t) => t.id === fullTemplateId)!;
    expect(item).toBeDefined();
    expect(item.payload).toBeUndefined();
    expect(item.counts).toEqual({ cards: 3, connections: 2, texts: 1, shapes: 1 });
    expect((await executor.get("/api/plan-templates")).body.some((t: { id: string }) => t.id === fullTemplateId)).toBe(false);

    const renamed = await admin.patch(`/api/plan-templates/${fullTemplateId}`).send({ name: "Lançamento padrão" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Lançamento padrão");
    expect(renamed.body.counts.cards).toBe(3);
    expect((await admin.patch(`/api/plan-templates/${fullTemplateId}`).send({ name: "  " })).status).toBe(400);
    expect((await executor.patch(`/api/plan-templates/${fullTemplateId}`).send({ name: "x" })).status).toBe(404);
    expect((await admin.patch("/api/plan-templates/not-a-uuid").send({ name: "x" })).status).toBe(404);

    expect((await executor.delete(`/api/plan-templates/${fullTemplateId}`)).status).toBe(404);
    expect((await admin.delete(`/api/plan-templates/${fullTemplateId}`)).status).toBe(200);
    expect((await admin.get("/api/plan-templates")).body.some((t: { id: string }) => t.id === fullTemplateId)).toBe(false);
  });
});
