import { describe, it, expect, afterAll } from "vitest";
import { db } from "@workspace/db";
import { strategyNodes, strategyCycles } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Smoke do grafo estratégico (§10) — TDD. Contrato:
 *  GET  /api/workspaces/:wId/strategy → { map, cycle, nodes[], edges[] }
 *       (cria lazy map strategy + 1º ciclo; idempotente)
 *  POST /api/workspaces/:wId/strategy/nodes   { kind, positionX, positionY, data }
 *  PATCH/DELETE .../strategy/nodes/:nodeId
 *  POST /api/workspaces/:wId/strategy/edges   { sourceNodeId, targetNodeId }
 *       (relation_type pré-preenchido pela gramática §6.5)
 *  PATCH/DELETE .../strategy/edges/:edgeId
 *  POST /api/workspaces/:wId/strategy/cycles
 *
 * node no payload: { id, kind, positionX, positionY, width, color, data: {...satélite} }
 * cycle: { id, label, status, startsOn, endsOn }
 * edge: { id, sourceNodeId, targetNodeId, relationType, label }
 */
describe("strategy graph smoke", () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(workspaceIds);
    for (const id of userIds) await deleteUser(id);
  });

  async function setup() {
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const ws = (await agent.post("/api/workspaces").send({ name: "StratWS" })).body;
    workspaceIds.push(ws.id);
    return { agent, user, wsId: ws.id as string };
  }

  const base = (wsId: string) => `/api/workspaces/${wsId}/strategy`;

  async function createNode(agent: any, wsId: string, kind: string, data: any) {
    const res = await agent.post(`${base(wsId)}/nodes`).send({ kind, positionX: 0, positionY: 0, data });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  it("lazy-creates the strategy map + first cycle, idempotently", async () => {
    const { agent, wsId } = await setup();
    const g1 = await agent.get(base(wsId));
    expect(g1.status).toBe(200);
    expect(g1.body.map.kind).toBe("strategy");
    expect(g1.body.cycle).toBeTruthy();
    expect(g1.body.cycle.status).toBe("ativo");
    expect(Array.isArray(g1.body.nodes)).toBe(true);
    expect(Array.isArray(g1.body.edges)).toBe(true);

    const g2 = await agent.get(base(wsId));
    expect(g2.status).toBe(200);
    expect(g2.body.map.id).toBe(g1.body.map.id); // mesmo map
    expect(g2.body.cycle.id).toBe(g1.body.cycle.id); // 1 ciclo ativo
  });

  it("creates an objetivo node WITH its satellite (transactional)", async () => {
    const { agent, wsId } = await setup();
    await agent.get(base(wsId)); // lazy init
    const node = await createNode(agent, wsId, "objetivo", { title: "Crescer receita" });
    expect(node.kind).toBe("objetivo");
    expect(node.data.title).toBe("Crescer receita");
    expect(node.data.status).toBe("provisorio");

    const g = await agent.get(base(wsId));
    const found = g.body.nodes.find((n: any) => n.id === node.id);
    expect(found).toBeTruthy();
    expect(found.data.title).toBe("Crescer receita");
  });

  it("prefills relation_type by the grammar (§6.5)", async () => {
    const { agent, wsId } = await setup();
    await agent.get(base(wsId));
    const obj = await createNode(agent, wsId, "objetivo", { title: "Obj" });
    const kr = await createNode(agent, wsId, "kr", { title: "KR", targetValue: 100 });
    const tema = await createNode(agent, wsId, "tema", { title: "Tema" });
    const plano = await createNode(agent, wsId, "plano", { hypothesis: "X→Y" });

    const mk = async (s: string, t: string) =>
      (await agent.post(`${base(wsId)}/edges`).send({ sourceNodeId: s, targetNodeId: t })).body;

    expect((await mk(kr.id, obj.id)).relationType).toBe("mede");
    expect((await mk(plano.id, kr.id)).relationType).toBe("move");
    expect((await mk(tema.id, obj.id)).relationType).toBe("serve");
    expect((await mk(tema.id, plano.id)).relationType).toBe("contem");

    // SWOT×SWOT não tipa (dispara fluxo de Tema no front)
    const s1 = await createNode(agent, wsId, "swot", { swotType: "forca", text: "f" });
    const s2 = await createNode(agent, wsId, "swot", { swotType: "ameaca", text: "a" });
    expect((await mk(s1.id, s2.id)).relationType).toBeNull();
  });

  it("deletes a node and its satellite + incident edges", async () => {
    const { agent, wsId } = await setup();
    await agent.get(base(wsId));
    const obj = await createNode(agent, wsId, "objetivo", { title: "O" });
    const kr = await createNode(agent, wsId, "kr", { title: "K", targetValue: 10 });
    const edge = (await agent.post(`${base(wsId)}/edges`).send({ sourceNodeId: kr.id, targetNodeId: obj.id })).body;

    const del = await agent.delete(`${base(wsId)}/nodes/${kr.id}`);
    expect(del.status).toBe(200);

    const g = await agent.get(base(wsId));
    expect(g.body.nodes.some((n: any) => n.id === kr.id)).toBe(false);
    expect(g.body.edges.some((e: any) => e.id === edge.id)).toBe(false); // aresta incidente removida
  });

  it("executor: 403 on structural writes, 200 only on KR current_value", async () => {
    const { agent: admin, wsId } = await setup();
    await admin.get(base(wsId));
    const kr = await createNode(admin, wsId, "kr", { title: "K", targetValue: 100 });

    // cria executor e adiciona ao workspace
    const { agent: exec, user: execUser } = await registerAndLogin();
    userIds.push(execUser.id);
    const add = await admin.post(`/api/workspaces/${wsId}/members`).send({ email: execUser.email, role: "executor" });
    expect(add.status).toBe(201);

    // executor pode VER
    expect((await exec.get(base(wsId))).status).toBe(200);

    // executor NÃO cria nó
    const cn = await exec.post(`${base(wsId)}/nodes`).send({ kind: "objetivo", positionX: 0, positionY: 0, data: { title: "x" } });
    expect(cn.status).toBe(403);

    // executor NÃO edita target/estrutura do KR
    const bad = await exec.patch(`${base(wsId)}/nodes/${kr.id}`).send({ data: { targetValue: 999 } });
    expect(bad.status).toBe(403);

    // executor PODE atualizar current_value do KR
    const ok = await exec.patch(`${base(wsId)}/nodes/${kr.id}`).send({ data: { currentValue: 42 } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const g = await admin.get(base(wsId));
    const krNode = g.body.nodes.find((n: any) => n.id === kr.id);
    expect(krNode.data.currentValue).toBe(42);
  });

  it("health wiring: PATCH anexa snapshot+trima(N); 1 ruim não vira, N viram; GET suaviza; objetivo agrega (§8.1)", async () => {
    const { agent, wsId } = await setup();
    await agent.get(base(wsId));
    const obj = await createNode(agent, wsId, "objetivo", { title: "Obj" });
    const kr = await createNode(agent, wsId, "kr", { title: "KR", targetValue: 100, currentValue: 0 });
    // liga KR→Objetivo (mede) p/ testar agregação
    await agent.post(`${base(wsId)}/edges`).send({ sourceNodeId: kr.id, targetNodeId: obj.id });

    const krHealth = async () => {
      const g = await agent.get(base(wsId));
      return g.body.nodes.find((n: any) => n.id === kr.id).data;
    };
    const objHealth = async () => {
      const g = await agent.get(base(wsId));
      return g.body.nodes.find((n: any) => n.id === obj.id).data.health;
    };

    // 1ª medição (ciclo recém-criado começa hoje → cedo → no_prazo)
    await agent.patch(`${base(wsId)}/nodes/${kr.id}`).send({ data: { currentValue: 10 } });
    expect((await krHealth()).health).toBe("no_prazo");
    // objetivo agrega o KR ligado por mede
    expect(await objHealth()).toBe("no_prazo");

    // força "atrasado": joga início do ciclo + criação do nó + alvo p/ o passado
    const mapId = (await agent.get(base(wsId))).body.map.id as string;
    await db.update(strategyCycles)
      .set({ startsOn: sql`CURRENT_DATE - interval '60 days'`, endsOn: sql`CURRENT_DATE - interval '30 days'` })
      .where(eq(strategyCycles.mapId, mapId));
    await db.update(strategyNodes).set({ createdAt: sql`now() - interval '60 days'` }).where(eq(strategyNodes.id, kr.id));

    // agora cada PATCH gera leitura "fora" (real 0.1, esperado 1.0)
    await agent.patch(`${base(wsId)}/nodes/${kr.id}`).send({ data: { currentValue: 10 } }); // 1 ruim
    expect((await krHealth()).health).toBe("no_prazo"); // suavização: 1 ruim não vira
    await agent.patch(`${base(wsId)}/nodes/${kr.id}`).send({ data: { currentValue: 10 } }); // 2 ruins
    expect((await krHealth()).health).toBe("no_prazo");
    await agent.patch(`${base(wsId)}/nodes/${kr.id}`).send({ data: { currentValue: 10 } }); // 3 ruins (N=3)
    const after = await krHealth();
    expect(after.health).toBe("fora"); // N consecutivos viram
    expect(after.healthReadings.length).toBeLessThanOrEqual(3); // trim a N

    // objetivo segue a saúde do KR (pior-caso por mede)
    expect(await objHealth()).toBe("fora");
  });

  it("PATCH revalida cross-table (target_date ≤ ciclo; action_map kind=action)", async () => {
    const { agent, wsId } = await setup();
    const g0 = await agent.get(base(wsId));
    const strategyMapId = g0.body.map.id as string; // map kind='strategy' (inválido p/ plano)

    const kr = await createNode(agent, wsId, "kr", { title: "K", targetValue: 100 });
    // target_date além do fim do ciclo (ciclo auto = +90d) → 400
    const badDate = await agent.patch(`${base(wsId)}/nodes/${kr.id}`).send({ data: { targetDate: "2099-12-31" } });
    expect(badDate.status).toBe(400);

    const plano = await createNode(agent, wsId, "plano", { hypothesis: "h" });
    // action_map_id apontando p/ um map kind='strategy' → 400
    const badMap = await agent.patch(`${base(wsId)}/nodes/${plano.id}`).send({ data: { actionMapId: strategyMapId } });
    expect(badMap.status).toBe(400);
  });

  it("agent read (5.1): payload tipado por kind, relation_type resolvido, ciclo arquivado read-only", async () => {
    const { agent, wsId } = await setup();
    await agent.get(base(wsId));
    const obj = await createNode(agent, wsId, "objetivo", { title: "O" });
    const kr = await createNode(agent, wsId, "kr", { title: "K", targetValue: 100, unit: "R$" });
    const swot = await createNode(agent, wsId, "swot", { swotType: "forca", text: "marca forte" });
    await agent.post(`${base(wsId)}/edges`).send({ sourceNodeId: kr.id, targetNodeId: obj.id });

    const g1 = await agent.get(base(wsId));
    const n = (id: string) => g1.body.nodes.find((x: any) => x.id === id);
    // payload tipado embutido por kind (reconstruível sem heurística)
    expect(n(obj.id).data.status).toBe("provisorio");
    expect(n(kr.id).data.targetValue).toBe(100);
    expect(n(kr.id).data.unit).toBe("R$");
    expect("health" in n(kr.id).data).toBe(true);
    expect("targetDate" in n(kr.id).data).toBe(true);
    expect(n(swot.id).data.swotType).toBe("forca");
    expect(n(swot.id).data.text).toBe("marca forte");
    // cada aresta traz relation_type (resolvido pela gramática)
    expect(g1.body.edges.every((e: any) => "relationType" in e)).toBe(true);
    expect(g1.body.edges[0].relationType).toBe("mede");
    // nós do ciclo ativo não são read-only
    expect(n(obj.id).readOnly).toBe(false);
    expect(n(kr.id).readOnly).toBe(false);
    // swot (sem ciclo) nunca read-only
    expect(n(swot.id).readOnly).toBe(false);

    // abre novo ciclo → objetivo/kr do ciclo anterior viram histórico read-only
    const nc = await agent.post(`${base(wsId)}/cycles`).send({ label: "Q2" });
    expect(nc.status).toBe(201);
    const g2 = await agent.get(base(wsId));
    const n2 = (id: string) => g2.body.nodes.find((x: any) => x.id === id);
    expect(g2.body.cycle.label).toBe("Q2");
    expect(n2(obj.id).readOnly).toBe(true); // ciclo arquivado
    expect(n2(kr.id).readOnly).toBe(true);
    expect(n2(swot.id).readOnly).toBe(false); // sem ciclo → segue ativo
  });
});
