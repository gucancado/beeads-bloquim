import { describe, it, expect, afterAll } from "vitest";
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
});
