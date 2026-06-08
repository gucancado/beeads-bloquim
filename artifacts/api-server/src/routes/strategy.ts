import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import {
  maps,
  strategyCycles,
  strategyNodes,
  strategyObjectives,
  strategyKrs,
  strategyThemes,
  strategySwotCards,
  strategyResources,
  strategyPlans,
  strategyEdges,
} from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole, getMemberRole } from "../middlewares/permissions";
import {
  computeKrHealthInstant,
  pushReading,
  smoothHealth,
  aggregateObjectiveHealth,
  DEFAULT_HEALTH_CONFIG,
  type HealthReading,
  type KrHealth,
} from "../services/strategyHealth";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

type NodeKind = "objetivo" | "swot" | "tema" | "kr" | "plano" | "recurso";

// ---------------------------------------------------------------------------
// Gramática de pré-preenchimento de relation_type (§6.5)
// ---------------------------------------------------------------------------
function prefillRelation(sourceKind: NodeKind, targetKind: NodeKind): string | null {
  if (sourceKind === "kr" && targetKind === "objetivo") return "mede";
  if (sourceKind === "plano" && targetKind === "kr") return "move";
  if (sourceKind === "tema" && targetKind === "objetivo") return "serve";
  if (sourceKind === "tema" && targetKind === "plano") return "contem";
  return null;
}

// ---------------------------------------------------------------------------
// Lazy: garante o map strategy + 1º ciclo ativo (idempotente, §10.3)
// ---------------------------------------------------------------------------
async function ensureStrategyMap(workspaceId: string, userId: string) {
  const existing = await db
    .select()
    .from(maps)
    .where(and(eq(maps.workspaceId, workspaceId), eq(maps.kind, "strategy")))
    .limit(1);
  if (existing[0]) return existing[0];

  try {
    const [created] = await db
      .insert(maps)
      .values({ workspaceId, name: "Mapa Estratégico", kind: "strategy", createdBy: userId })
      .returning();
    return created;
  } catch (err: unknown) {
    // Corrida: outro request criou primeiro (índice único parcial). Relê.
    if (typeof err === "object" && err && "code" in err && (err as { code: unknown }).code === "23505") {
      const [row] = await db
        .select()
        .from(maps)
        .where(and(eq(maps.workspaceId, workspaceId), eq(maps.kind, "strategy")))
        .limit(1);
      return row;
    }
    throw err;
  }
}

async function ensureActiveCycle(mapId: string) {
  const active = await db
    .select()
    .from(strategyCycles)
    .where(and(eq(strategyCycles.mapId, mapId), eq(strategyCycles.status, "ativo")))
    .limit(1);
  if (active[0]) return active[0];

  try {
    const [created] = await db
      .insert(strategyCycles)
      .values({
        mapId,
        label: "Ciclo atual",
        startsOn: sql`CURRENT_DATE`,
        endsOn: sql`CURRENT_DATE + interval '90 days'`,
        status: "ativo",
      })
      .returning();
    return created;
  } catch (err: unknown) {
    if (typeof err === "object" && err && "code" in err && (err as { code: unknown }).code === "23505") {
      const [row] = await db
        .select()
        .from(strategyCycles)
        .where(and(eq(strategyCycles.mapId, mapId), eq(strategyCycles.status, "ativo")))
        .limit(1);
      return row;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Serialização: monta nós com satélite por kind
// ---------------------------------------------------------------------------
async function loadGraph(mapId: string) {
  const nodes = await db.select().from(strategyNodes).where(eq(strategyNodes.mapId, mapId));
  const ids = nodes.map((n) => n.id);

  const sat: Record<NodeKind, Map<string, any>> = {
    objetivo: new Map(),
    kr: new Map(),
    tema: new Map(),
    swot: new Map(),
    recurso: new Map(),
    plano: new Map(),
  };

  if (ids.length > 0) {
    const [objs, krs, themes, swots, resources, plans] = await Promise.all([
      db.select().from(strategyObjectives).where(inArray(strategyObjectives.nodeId, ids)),
      db.select().from(strategyKrs).where(inArray(strategyKrs.nodeId, ids)),
      db.select().from(strategyThemes).where(inArray(strategyThemes.nodeId, ids)),
      db.select().from(strategySwotCards).where(inArray(strategySwotCards.nodeId, ids)),
      db.select().from(strategyResources).where(inArray(strategyResources.nodeId, ids)),
      db.select().from(strategyPlans).where(inArray(strategyPlans.nodeId, ids)),
    ]);
    for (const o of objs) sat.objetivo.set(o.nodeId, o);
    for (const k of krs) sat.kr.set(k.nodeId, k);
    for (const t of themes) sat.tema.set(t.nodeId, t);
    for (const s of swots) sat.swot.set(s.nodeId, s);
    for (const r of resources) sat.recurso.set(r.nodeId, r);
    for (const p of plans) sat.plano.set(p.nodeId, p);
  }

  const serializedNodes = nodes.map((n) => {
    const { nodeId: _omit, ...data } = (sat[n.kind as NodeKind].get(n.id) ?? {}) as any;
    return {
      id: n.id,
      kind: n.kind,
      positionX: n.positionX,
      positionY: n.positionY,
      width: n.width,
      color: n.color,
      data: data as Record<string, any>,
    };
  });

  const edges = await db.select().from(strategyEdges).where(eq(strategyEdges.mapId, mapId));
  const serializedEdges = edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    relationType: e.relationType,
    label: e.label,
    metadata: e.metadata,
  }));

  // Saúde do Objetivo: agregação pior-caso dos KRs ligados por aresta `mede`
  // (§8.1). KR traz a saúde suavizada já armazenada. (gap #2)
  const krHealthById = new Map<string, KrHealth | null>();
  for (const n of serializedNodes) {
    if (n.kind === "kr") krHealthById.set(n.id, (n.data.health ?? null) as KrHealth | null);
  }
  for (const n of serializedNodes) {
    if (n.kind !== "objetivo") continue;
    const measuringKrIds = serializedEdges
      .filter((e) => e.relationType === "mede" && e.targetNodeId === n.id)
      .map((e) => e.sourceNodeId)
      .filter((id) => krHealthById.has(id));
    n.data.health = aggregateObjectiveHealth(measuringKrIds.map((id) => krHealthById.get(id) ?? null));
  }

  return { nodes: serializedNodes, edges: serializedEdges };
}

async function getStrategyNodeInWorkspace(nodeId: string, workspaceId: string) {
  const [row] = await db
    .select({ node: strategyNodes })
    .from(strategyNodes)
    .innerJoin(maps, eq(maps.id, strategyNodes.mapId))
    .where(
      and(
        eq(strategyNodes.id, nodeId),
        eq(maps.workspaceId, workspaceId),
        eq(maps.kind, "strategy"),
      ),
    )
    .limit(1);
  return row?.node ?? null;
}

/**
 * Recalcula a saúde do KR (§8.1, step 5/5b): saúde instantânea com `hoje`,
 * empurra snapshot em health_readings (trim a N), e armazena a saúde suavizada.
 * Chamado em toda mudança de campo que afeta saúde (current/target/baseline/
 * direction/target_date).
 */
async function recomputeKrHealth(nodeId: string): Promise<void> {
  const [kr] = await db.select().from(strategyKrs).where(eq(strategyKrs.nodeId, nodeId)).limit(1);
  if (!kr) return;
  const [cycle] = await db.select().from(strategyCycles).where(eq(strategyCycles.id, kr.cycleId)).limit(1);
  const [node] = await db.select({ createdAt: strategyNodes.createdAt }).from(strategyNodes).where(eq(strategyNodes.id, nodeId)).limit(1);
  if (!cycle || !node) return;

  const instant = computeKrHealthInstant({
    targetValue: kr.targetValue,
    currentValue: kr.currentValue,
    baselineValue: kr.baselineValue,
    direction: kr.direction,
    createdAt: node.createdAt,
    targetDate: kr.targetDate ?? cycle.endsOn,
    cycleStartsOn: cycle.startsOn,
    today: new Date(),
  });
  const reading: HealthReading = {
    health: instant.health,
    ratio: Number.isFinite(instant.ratio ?? NaN) ? (instant.ratio as number) : null,
    at: new Date().toISOString(),
  };
  const readings = pushReading(kr.healthReadings ?? [], reading, DEFAULT_HEALTH_CONFIG.smoothingN);
  const smoothed = smoothHealth(readings, DEFAULT_HEALTH_CONFIG);
  await db.update(strategyKrs).set({ healthReadings: readings, health: smoothed }).where(eq(strategyKrs.nodeId, nodeId));
}

// ---------------------------------------------------------------------------
// GET /strategy — grafo inteiro (lazy create)
// ---------------------------------------------------------------------------
router.get("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const userId = req.user!.userId;

  const map = await ensureStrategyMap(workspaceId, userId);
  const cycle = await ensureActiveCycle(map.id);
  const graph = await loadGraph(map.id);

  res.json({
    map: { id: map.id, kind: map.kind, name: map.name, workspaceId: map.workspaceId },
    cycle: cycle
      ? { id: cycle.id, label: cycle.label, status: cycle.status, startsOn: cycle.startsOn, endsOn: cycle.endsOn }
      : null,
    nodes: graph.nodes,
    edges: graph.edges,
  });
});

// ---------------------------------------------------------------------------
// POST /strategy/nodes — cria nó + satélite (transacional, §10.3)
// ---------------------------------------------------------------------------
const createNodeSchema = z.object({
  kind: z.enum(["objetivo", "swot", "tema", "kr", "plano", "recurso"]),
  positionX: z.number().optional().default(0),
  positionY: z.number().optional().default(0),
  width: z.number().nullable().optional(),
  color: z.string().nullable().optional(),
  data: z.record(z.string(), z.any()).optional().default({}),
});

router.post("/nodes", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const parsed = createNodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const { workspaceId } = req.params;
  const userId = req.user!.userId;
  const { kind, positionX, positionY, width, color, data } = parsed.data;

  const map = await ensureStrategyMap(workspaceId, userId);
  const cycle = await ensureActiveCycle(map.id);

  // Validações cross-table (app-level, §2.2-step4)
  if (kind === "objetivo" || kind === "kr") {
    if (!cycle) {
      res.status(409).json({ error: "Conflict", message: "Sem ciclo ativo" });
      return;
    }
  }
  if (kind === "kr") {
    if (typeof data.targetValue !== "number") {
      res.status(400).json({ error: "Validation error", message: "KR requer targetValue numérico" });
      return;
    }
    const direction = data.direction ?? "subir";
    const baseline = typeof data.baselineValue === "number" ? data.baselineValue : null;
    if (baseline !== null && data.targetValue !== baseline) {
      if (direction === "subir" && !(data.targetValue > baseline)) {
        res.status(400).json({ error: "Validation error", message: "direction 'subir' exige target > baseline" });
        return;
      }
      if (direction === "descer" && !(data.targetValue < baseline)) {
        res.status(400).json({ error: "Validation error", message: "direction 'descer' exige target < baseline" });
        return;
      }
    }
    if (data.targetDate && cycle && data.targetDate > cycle.endsOn) {
      res.status(400).json({ error: "Validation error", message: "target_date deve ser ≤ fim do ciclo" });
      return;
    }
  }
  if (kind === "swot" && !["forca", "fraqueza", "oportunidade", "ameaca"].includes(data.swotType)) {
    res.status(400).json({ error: "Validation error", message: "swotType inválido" });
    return;
  }
  if (kind === "recurso" && !["meta_ads", "google_ads", "site", "instagram", "outro"].includes(data.resourceKind)) {
    res.status(400).json({ error: "Validation error", message: "resourceKind inválido" });
    return;
  }
  if (kind === "plano" && data.actionMapId) {
    const [target] = await db
      .select({ id: maps.id })
      .from(maps)
      .where(and(eq(maps.id, data.actionMapId), eq(maps.workspaceId, workspaceId), eq(maps.kind, "action")))
      .limit(1);
    if (!target) {
      res.status(400).json({ error: "Validation error", message: "action_map_id deve referenciar um map kind='action' do workspace" });
      return;
    }
  }

  const created = await db.transaction(async (tx) => {
    const [node] = await tx
      .insert(strategyNodes)
      .values({ mapId: map.id, workspaceId, kind, positionX, positionY, width: width ?? null, color: color ?? null, createdBy: userId })
      .returning();

    let satellite: any;
    switch (kind) {
      case "objetivo":
        [satellite] = await tx.insert(strategyObjectives).values({
          nodeId: node.id,
          cycleId: cycle!.id,
          title: data.title ?? "Objetivo",
          description: data.description ?? null,
          status: data.status ?? "provisorio",
        }).returning();
        break;
      case "kr":
        [satellite] = await tx.insert(strategyKrs).values({
          nodeId: node.id,
          cycleId: cycle!.id,
          title: data.title ?? "KR",
          unit: data.unit ?? null,
          targetValue: data.targetValue,
          currentValue: typeof data.currentValue === "number" ? data.currentValue : 0,
          baselineValue: typeof data.baselineValue === "number" ? data.baselineValue : null,
          direction: data.direction ?? "subir",
          targetDate: data.targetDate ?? cycle!.endsOn,
        }).returning();
        break;
      case "tema":
        [satellite] = await tx.insert(strategyThemes).values({
          nodeId: node.id,
          title: data.title ?? "Tema",
          description: data.description ?? null,
        }).returning();
        break;
      case "swot":
        [satellite] = await tx.insert(strategySwotCards).values({
          nodeId: node.id,
          swotType: data.swotType,
          text: data.text ?? "",
        }).returning();
        break;
      case "recurso":
        [satellite] = await tx.insert(strategyResources).values({
          nodeId: node.id,
          resourceKind: data.resourceKind,
          label: data.label ?? "",
          binding: data.binding ?? null,
        }).returning();
        break;
      case "plano":
        [satellite] = await tx.insert(strategyPlans).values({
          nodeId: node.id,
          actionMapId: data.actionMapId ?? null,
          hypothesis: data.hypothesis ?? null,
        }).returning();
        break;
    }
    return { node, satellite };
  });

  const { nodeId: _omit, ...satData } = created.satellite as any;
  res.status(201).json({
    id: created.node.id,
    kind: created.node.kind,
    positionX: created.node.positionX,
    positionY: created.node.positionY,
    width: created.node.width,
    color: created.node.color,
    data: satData,
  });
});

// ---------------------------------------------------------------------------
// PATCH /strategy/nodes/:nodeId — autosave (posição/campos). Executor: só
// current_value de KR (§10.2 escrita estreita).
// ---------------------------------------------------------------------------
router.patch("/nodes/:nodeId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, nodeId } = req.params;
  const userId = req.user!.userId;
  const role = await getMemberRole(workspaceId, userId);

  const node = await getStrategyNodeInWorkspace(nodeId, workspaceId);
  if (!node) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const body = req.body as { positionX?: number; positionY?: number; width?: number; color?: string; data?: Record<string, any> };
  const data = body.data ?? {};

  // Escrita estreita do executor (gap #6): SÓ current_value de KR.
  if (role === "executor") {
    const keys = Object.keys(data);
    const touchesNonData = body.positionX !== undefined || body.positionY !== undefined || body.width !== undefined || body.color !== undefined;
    const onlyCurrentValue = node.kind === "kr" && keys.length === 1 && keys[0] === "currentValue" && !touchesNonData;
    if (!onlyCurrentValue) {
      res.status(403).json({ error: "Forbidden", message: "Executor só pode atualizar current_value de KR" });
      return;
    }
    await db.update(strategyKrs).set({ currentValue: data.currentValue }).where(eq(strategyKrs.nodeId, nodeId));
    await recomputeKrHealth(nodeId); // snapshot + suavização (§8.1)
    res.json({ ok: true });
    return;
  }

  // admin/editor: posição + campos do satélite por kind
  const nodePatch: Record<string, any> = { updatedAt: new Date() };
  if (body.positionX !== undefined) nodePatch.positionX = body.positionX;
  if (body.positionY !== undefined) nodePatch.positionY = body.positionY;
  if (body.width !== undefined) nodePatch.width = body.width;
  if (body.color !== undefined) nodePatch.color = body.color;

  await db.transaction(async (tx) => {
    if (Object.keys(nodePatch).length > 1) {
      await tx.update(strategyNodes).set(nodePatch).where(eq(strategyNodes.id, nodeId));
    }
    if (Object.keys(data).length > 0) {
      switch (node.kind) {
        case "objetivo":
          await tx.update(strategyObjectives).set(pick(data, ["title", "description", "status"])).where(eq(strategyObjectives.nodeId, nodeId));
          break;
        case "kr":
          await tx.update(strategyKrs).set(pick(data, ["title", "unit", "targetValue", "currentValue", "baselineValue", "direction", "targetDate"])).where(eq(strategyKrs.nodeId, nodeId));
          break;
        case "tema":
          await tx.update(strategyThemes).set(pick(data, ["title", "description"])).where(eq(strategyThemes.nodeId, nodeId));
          break;
        case "swot":
          await tx.update(strategySwotCards).set(pick(data, ["swotType", "text"])).where(eq(strategySwotCards.nodeId, nodeId));
          break;
        case "recurso":
          await tx.update(strategyResources).set(pick(data, ["resourceKind", "label", "binding"])).where(eq(strategyResources.nodeId, nodeId));
          break;
        case "plano":
          await tx.update(strategyPlans).set(pick(data, ["actionMapId", "hypothesis"])).where(eq(strategyPlans.nodeId, nodeId));
          break;
      }
    }
  });

  // Campos que afetam saúde do KR → recalcula snapshot + suavização (§8.1).
  if (node.kind === "kr") {
    const healthFields = ["currentValue", "targetValue", "baselineValue", "direction", "targetDate"];
    if (healthFields.some((f) => f in data)) {
      await recomputeKrHealth(nodeId);
    }
  }

  res.json({ ok: true });
});

function pick(obj: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ---------------------------------------------------------------------------
// DELETE /strategy/nodes/:nodeId — cascade remove satélite + arestas
// ---------------------------------------------------------------------------
router.delete("/nodes/:nodeId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { workspaceId, nodeId } = req.params;
  const node = await getStrategyNodeInWorkspace(nodeId, workspaceId);
  if (!node) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(strategyNodes).where(eq(strategyNodes.id, nodeId)); // cascade satélite + edges
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /strategy/edges — cria aresta com pré-preenchimento de relation_type
// ---------------------------------------------------------------------------
const createEdgeSchema = z.object({
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  label: z.string().nullable().optional(),
  relationType: z.string().nullable().optional(),
});

router.post("/edges", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const parsed = createEdgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const { workspaceId } = req.params;
  const userId = req.user!.userId;
  const { sourceNodeId, targetNodeId, label } = parsed.data;

  const source = await getStrategyNodeInWorkspace(sourceNodeId, workspaceId);
  const target = await getStrategyNodeInWorkspace(targetNodeId, workspaceId);
  if (!source || !target) {
    res.status(404).json({ error: "Not found", message: "source ou target não encontrado neste mapa" });
    return;
  }
  if (source.mapId !== target.mapId) {
    res.status(400).json({ error: "Validation error", message: "arestas só entre nós do mesmo mapa" });
    return;
  }

  // relation_type explícito vence; senão pré-preenche pela gramática.
  const relationType =
    parsed.data.relationType !== undefined
      ? parsed.data.relationType
      : prefillRelation(source.kind as NodeKind, target.kind as NodeKind);

  const [edge] = await db
    .insert(strategyEdges)
    .values({ mapId: source.mapId, sourceNodeId, targetNodeId, relationType, label: label ?? null, createdBy: userId })
    .returning();

  res.status(201).json({
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    relationType: edge.relationType,
    label: edge.label,
    metadata: edge.metadata,
  });
});

// ---------------------------------------------------------------------------
// PATCH /strategy/edges/:edgeId — relation_type/label/metadata
// ---------------------------------------------------------------------------
const updateEdgeSchema = z.object({
  relationType: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  metadata: z.any().optional(),
});

router.patch("/edges/:edgeId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const parsed = updateEdgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const { workspaceId, edgeId } = req.params;
  const [edge] = await db
    .select({ e: strategyEdges })
    .from(strategyEdges)
    .innerJoin(maps, eq(maps.id, strategyEdges.mapId))
    .where(and(eq(strategyEdges.id, edgeId), eq(maps.workspaceId, workspaceId), eq(maps.kind, "strategy")))
    .limit(1);
  if (!edge) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [updated] = await db.update(strategyEdges).set(pick(parsed.data, ["relationType", "label", "metadata"])).where(eq(strategyEdges.id, edgeId)).returning();
  res.json({
    id: updated.id,
    sourceNodeId: updated.sourceNodeId,
    targetNodeId: updated.targetNodeId,
    relationType: updated.relationType,
    label: updated.label,
    metadata: updated.metadata,
  });
});

// ---------------------------------------------------------------------------
// DELETE /strategy/edges/:edgeId
// ---------------------------------------------------------------------------
router.delete("/edges/:edgeId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { workspaceId, edgeId } = req.params;
  const [edge] = await db
    .select({ id: strategyEdges.id })
    .from(strategyEdges)
    .innerJoin(maps, eq(maps.id, strategyEdges.mapId))
    .where(and(eq(strategyEdges.id, edgeId), eq(maps.workspaceId, workspaceId), eq(maps.kind, "strategy")))
    .limit(1);
  if (!edge) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(strategyEdges).where(eq(strategyEdges.id, edgeId));
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /strategy/cycles — abre novo ciclo (arquiva o ativo)
// ---------------------------------------------------------------------------
const createCycleSchema = z.object({
  label: z.string().min(1),
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
});

router.post("/cycles", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const parsed = createCycleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const { workspaceId } = req.params;
  const userId = req.user!.userId;
  const map = await ensureStrategyMap(workspaceId, userId);

  const cycle = await db.transaction(async (tx) => {
    await tx.update(strategyCycles).set({ status: "arquivado" }).where(and(eq(strategyCycles.mapId, map.id), eq(strategyCycles.status, "ativo")));
    const [created] = await tx
      .insert(strategyCycles)
      .values({
        mapId: map.id,
        label: parsed.data.label,
        startsOn: parsed.data.startsOn ? sql`${parsed.data.startsOn}::date` : sql`CURRENT_DATE`,
        endsOn: parsed.data.endsOn ? sql`${parsed.data.endsOn}::date` : sql`CURRENT_DATE + interval '90 days'`,
        status: "ativo",
      })
      .returning();
    return created;
  });

  res.status(201).json({ id: cycle.id, label: cycle.label, status: cycle.status, startsOn: cycle.startsOn, endsOn: cycle.endsOn });
});

export default router;
