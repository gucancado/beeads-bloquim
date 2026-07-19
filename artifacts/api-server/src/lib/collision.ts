// artifacts/api-server/src/lib/collision.ts

/**
 * Dimensões nominais de um card no canvas. O card renderizado pode crescer com
 * o conteúdo, mas layout e detecção de colisão trabalham com a caixa nominal —
 * é o que o servidor consegue saber sem medir o DOM.
 *
 * ALTURA: o card renderizado varia MUITO com o conteúdo (medido em 2026-07-16):
 * sem tarefa ~60px, tarefa simples ~175px, tarefa COM DESCRIÇÃO ~254px, e com
 * título de 2 linhas + datas empilhadas pode chegar a ~320px. O dagre separa
 * irmãos por altura+nodesep, então uma altura subestimada faz irmãos empilhados
 * (fan-out/convergência) se sobreporem — foi o que aconteceu com 200 num mapa de
 * cards descritivos (254px reais > 200+48 de gap). Usamos 320 pra cobrir
 * praticamente todos os cards não-expandidos. Como cadeias lineares têm 1 card
 * por rank (sem irmão vertical), o valor maior NÃO incha cadeias — só dá o
 * respiro necessário onde os cards de fato empilham. Alimenta também o free-slot
 * de criação e a grade de isolados.
 *
 * LARGURA: o card real mede ~220px (min-w-[220px]). Mantemos 200 de propósito —
 * não é a causa de sobreposição (colunas a width+ranksep=320px deixam 100px de
 * folga pra um card de 220), e mexer recalibraria todas as colunas do layout.
 */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 320;

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

/** Duas caixas se sobrepõem, considerando um respiro `gap` obrigatório entre elas. */
export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export type FreeSlotOpts = {
  gap?: number;
  stepX?: number;
  stepY?: number;
  maxRings?: number;
};

/**
 * Acha o ponto livre mais próximo de `desired` pra uma caixa `size`, varrendo
 * anéis concêntricos e, dentro de cada anel, testando os candidatos do mais
 * perto pro mais longe (empate → prefere abaixo, depois à direita, que é a
 * ordem natural de irmãos no canvas).
 *
 * Determinístico. Se não achar vaga em `maxRings` anéis, devolve `desired` —
 * degrada pro comportamento antigo em vez de travar a criação do card.
 */
export function findFreeSlot(
  desired: Point,
  size: { width: number; height: number },
  occupied: Box[],
  opts: FreeSlotOpts = {},
): Point {
  const gap = opts.gap ?? 24;
  const stepX = opts.stepX ?? size.width + gap;
  const stepY = opts.stepY ?? size.height + gap;
  const maxRings = opts.maxRings ?? 12;

  const fits = (x: number, y: number): boolean =>
    !occupied.some((o) =>
      boxesOverlap({ x, y, width: size.width, height: size.height }, o, gap),
    );

  if (fits(desired.x, desired.y)) return { x: desired.x, y: desired.y };

  for (let ring = 1; ring <= maxRings; ring++) {
    const candidates: Array<{ x: number; y: number; dx: number; dy: number; dist: number }> = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; // só o perímetro
        const x = desired.x + dx * stepX;
        const y = desired.y + dy * stepY;
        candidates.push({ x, y, dx, dy, dist: Math.hypot(x - desired.x, y - desired.y) });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist || b.dy - a.dy || b.dx - a.dx);
    for (const c of candidates) if (fits(c.x, c.y)) return { x: c.x, y: c.y };
  }

  return { x: desired.x, y: desired.y };
}
