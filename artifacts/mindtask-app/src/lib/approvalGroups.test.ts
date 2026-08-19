import { describe, it, expect } from 'vitest';
import { buildApprovalGroupIndex, expandPositionChanges } from './approvalGroups';
import { applyNodeChanges, type Node } from 'reactflow';
import type { NodeChange, XYPosition } from 'reactflow';

const parent = (id: string, taskId: string, mode?: string) => ({
  id, taskId, taskIsApprovalTask: false, taskParentTaskId: null, taskApprovalMode: mode ?? null,
});
const approval = (id: string, parentTaskId: string) => ({
  id, taskId: `task-${id}`, taskIsApprovalTask: true, taskParentTaskId: parentTaskId, taskApprovalMode: null,
});

describe('buildApprovalGroupIndex', () => {
  it('agrupa pai + aprovações sequenciais, sem join node', () => {
    const idx = buildApprovalGroupIndex([
      parent('p1', 't1', 'sequential'), approval('a1', 't1'), approval('a2', 't1'),
    ]);
    const members = ['p1', 'a1', 'a2'];
    expect(idx.get('p1')).toEqual(members);
    expect(idx.get('a1')).toEqual(members);
    expect(idx.get('a2')).toEqual(members);
    expect(idx.has('join-p1')).toBe(false);
  });

  it('modo paralelo com 2+ aprovações inclui o join node como membro E como chave', () => {
    const idx = buildApprovalGroupIndex([
      parent('p1', 't1', 'parallel'), approval('a1', 't1'), approval('a2', 't1'),
    ]);
    const members = ['p1', 'a1', 'a2', 'join-p1'];
    expect(idx.get('p1')).toEqual(members);
    expect(idx.get('join-p1')).toEqual(members);
  });

  it('modo paralelo com 1 aprovação NÃO cria join (espelha buildJoinNodes: children >= 2)', () => {
    const idx = buildApprovalGroupIndex([parent('p1', 't1', 'parallel'), approval('a1', 't1')]);
    expect(idx.get('p1')).toEqual(['p1', 'a1']);
    expect(idx.has('join-p1')).toBe(false);
  });

  it('approvalMode ausente default sequential (sem join)', () => {
    const idx = buildApprovalGroupIndex([
      parent('p1', 't1'), approval('a1', 't1'), approval('a2', 't1'),
    ]);
    expect(idx.has('join-p1')).toBe(false);
  });

  it('card sem aprovações fica fora do índice', () => {
    const idx = buildApprovalGroupIndex([parent('p1', 't1'), parent('p2', 't2')]);
    expect(idx.size).toBe(0);
  });

  it('aprovação órfã (sem card-pai no mapa) fica fora do índice', () => {
    const idx = buildApprovalGroupIndex([approval('a1', 't-fantasma')]);
    expect(idx.size).toBe(0);
  });

  it('dois grupos independentes não se misturam', () => {
    const idx = buildApprovalGroupIndex([
      parent('p1', 't1'), approval('a1', 't1'),
      parent('p2', 't2'), approval('b1', 't2'),
    ]);
    expect(idx.get('a1')).toEqual(['p1', 'a1']);
    expect(idx.get('b1')).toEqual(['p2', 'b1']);
  });
});

describe('expandPositionChanges', () => {
  const groupIndex = buildApprovalGroupIndex([
    parent('p1', 't1', 'parallel'), approval('a1', 't1'), approval('a2', 't1'),
    parent('solo', 't9'),
  ]);
  // membros do grupo: p1, a1, a2, join-p1

  const positions: Record<string, XYPosition> = {
    p1: { x: 100, y: 100 },
    a1: { x: 450, y: 250 },
    a2: { x: 500, y: 370 },
    'join-p1': { x: 760, y: 300 },
    livre: { x: 0, y: 0 },
  };
  const getPos = (id: string) => positions[id];

  it('drag do pai propaga o mesmo delta pros demais membros (incl. join), com flag dragging', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', position: { x: 110, y: 95 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({ id: 'a1', type: 'position', position: { x: 460, y: 245 }, positionAbsolute: { x: 460, y: 245 }, dragging: true });
    expect(out[2]).toEqual({ id: 'a2', type: 'position', position: { x: 510, y: 365 }, positionAbsolute: { x: 510, y: 365 }, dragging: true });
    expect(out[3]).toEqual({ id: 'join-p1', type: 'position', position: { x: 770, y: 295 }, positionAbsolute: { x: 770, y: 295 }, dragging: true });
  });

  it('drag de uma aprovação move pai e irmãos', () => {
    const changes: NodeChange[] = [
      { id: 'a1', type: 'position', position: { x: 470, y: 250 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    const ids = out.map(c => c.id).sort();
    expect(ids).toEqual(['a1', 'a2', 'join-p1', 'p1']);
    const p1Change = out.find(c => c.id === 'p1');
    expect(p1Change).toMatchObject({ position: { x: 120, y: 100 } });
  });

  it('membros com change explícita não recebem propagação duplicada (seleção com pai+filho)', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', position: { x: 110, y: 110 }, dragging: true },
      { id: 'a1', type: 'position', position: { x: 460, y: 260 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out.filter(c => c.id === 'a1')).toHaveLength(1);
    expect(out.filter(c => c.id === 'a2')).toHaveLength(1);
    expect(out.filter(c => c.id === 'join-p1')).toHaveLength(1);
    expect(out).toHaveLength(4);
  });

  it('node fora de grupo não gera propagação e retorna o array original (identidade)', () => {
    const changes: NodeChange[] = [
      { id: 'livre', type: 'position', position: { x: 5, y: 5 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toBe(changes);
  });

  it('changes não-position passam intactas e não propagam', () => {
    const changes: NodeChange[] = [{ id: 'p1', type: 'select', selected: true }];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toBe(changes);
  });

  it('change de posição sem position mas com dragging propaga só a flag (fim de drag do RF)', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', dragging: false },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({ id: 'a1', type: 'position', dragging: false });
  });

  it('origem sem posição conhecida (getPosition undefined) não propaga', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', position: { x: 110, y: 95 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, () => undefined, groupIndex);
    expect(out).toBe(changes);
  });

  it('delta zero ainda propaga (mantém flags dragging do grupo em sincronia)', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', position: { x: 100, y: 100 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toHaveLength(4);
    expect(out[1]).toMatchObject({ id: 'a1', position: { x: 450, y: 250 }, dragging: true });
  });

  it('integra com applyNodeChanges: frames sucessivos + change final sem position mantêm o grupo rígido', () => {
    let nodes: Node[] = [
      { id: 'p1', type: 'mindmap', position: { x: 100, y: 100 }, data: {} },
      { id: 'a1', type: 'approvalnode', position: { x: 450, y: 250 }, data: {} },
      { id: 'a2', type: 'approvalnode', position: { x: 500, y: 370 }, data: {} },
      { id: 'join-p1', type: 'joinnode', position: { x: 760, y: 300 }, data: {} },
    ];
    const livePos = (id: string) => nodes.find(n => n.id === id)?.position;
    const frames: NodeChange[][] = [
      [{ id: 'p1', type: 'position', position: { x: 110, y: 100 }, dragging: true }],
      [{ id: 'p1', type: 'position', position: { x: 115, y: 107 }, dragging: true }],
      [{ id: 'p1', type: 'position', dragging: false }],
    ];
    for (const changes of frames) {
      nodes = applyNodeChanges(expandPositionChanges(changes, livePos, groupIndex), nodes);
    }
    expect(nodes.find(n => n.id === 'p1')!.position).toEqual({ x: 115, y: 107 });
    expect(nodes.find(n => n.id === 'a1')!.position).toEqual({ x: 465, y: 257 });
    expect(nodes.find(n => n.id === 'a2')!.position).toEqual({ x: 515, y: 377 });
    expect(nodes.find(n => n.id === 'join-p1')!.position).toEqual({ x: 775, y: 307 });
    expect(nodes.every(n => n.dragging !== true)).toBe(true);
  });
});
