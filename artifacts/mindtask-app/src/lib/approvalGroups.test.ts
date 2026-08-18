import { describe, it, expect } from 'vitest';
import { buildApprovalGroupIndex } from './approvalGroups';

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
