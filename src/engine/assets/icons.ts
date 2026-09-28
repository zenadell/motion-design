// Line-art icons for the particle-morph technique. Each returns polylines in a
// ±330 px box centred on 0,0. Particles are distributed along their length.

import { DEG, TAU, type Vec2 } from '../core/math';

export type Poly = Vec2[];

export function rrect(x: number, y: number, w: number, h: number, r: number, seg = 6): Poly {
  const pts: Poly = [];
  for (const [cx, cy, a0] of [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]])
    for (let i = 0; i <= seg; i++) {
      const a = (a0 + (90 * i) / seg) * DEG;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  pts.push(pts[0]);
  return pts;
}
export function circ(cx: number, cy: number, r: number, n = 24): Poly {
  const pts: Poly = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 18): Poly {
  const pts: Poly = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
export function ellipse(cx: number, cy: number, rx: number, ry: number, n = 36): Poly {
  const pts: Poly = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
export const seg2 = (x1: number, y1: number, x2: number, y2: number): Poly => [[x1, y1], [x2, y2]];
const closed = (pts: Vec2[]): Poly => [...pts, pts[0]];

export const ICONS: Record<string, () => Poly[]> = {
  web: () => [
    rrect(-380, -250, 760, 500, 28), seg2(-380, -185, 380, -185), circ(-338, -218, 9, 12), circ(-306, -218, 9, 12), circ(-274, -218, 9, 12),
    rrect(-190, -234, 380, 32, 16, 4), rrect(-330, -135, 330, 46, 10, 3), seg2(-330, -55, 20, -55), seg2(-330, -15, -20, -15), seg2(-330, 25, -80, 25),
    rrect(-330, 85, 170, 54, 27, 5), rrect(60, -135, 280, 330, 20), circ(200, -50, 42, 18), [[80, 170], [170, 70], [230, 130], [270, 95], [320, 170]],
  ],
  mobile: () => {
    const p = [rrect(-170, -330, 340, 660, 54), rrect(-48, -308, 96, 24, 12, 4), seg2(-60, 300, 60, 300)];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) p.push(rrect(-88 + c * 88 - 30, -200 + r * 98 - 30, 60, 60, 16, 3));
    return p;
  },
  ai: () => {
    const layers = [3, 5, 5, 3], xs = [-300, -100, 100, 300], p: Poly[] = [], nodes: Vec2[][] = [];
    layers.forEach((n, li) => {
      const col: Vec2[] = [];
      for (let k = 0; k < n; k++) {
        const y = (k - (n - 1) / 2) * 118;
        col.push([xs[li], y]);
        p.push(circ(xs[li], y, 22, 16));
      }
      nodes.push(col);
    });
    for (let li = 0; li < 3; li++)
      for (const a of nodes[li])
        for (const b of nodes[li + 1]) {
          const d = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d;
          p.push(seg2(a[0] + ux * 24, a[1] + uy * 24, b[0] - ux * 24, b[1] - uy * 24));
        }
    return p;
  },
  ux: () => [
    rrect(-330, -250, 310, 220, 22), rrect(20, -250, 310, 220, 22), rrect(-330, 10, 310, 220, 22), rrect(20, 10, 310, 220, 22),
    seg2(-300, -200, -120, -200), seg2(50, -200, 230, -200), seg2(-300, 60, -160, 60),
    [[90, 60], [90, 200], [124, 168], [150, 226], [174, 215], [148, 158], [196, 158], [90, 60]],
  ],
  motion: () => {
    const P0 = [-300, 230], P1 = [60, 230], P2 = [-60, -230], P3 = [300, -230], curve: Poly = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
      curve.push([a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]]);
    }
    const dia = (x: number, y: number, s: number): Poly => [[x, y - s], [x + s, y], [x, y + s], [x - s, y], [x, y - s]];
    return [curve, seg2(P0[0], P0[1], P1[0], P1[1]), seg2(P3[0], P3[1], P2[0], P2[1]), circ(P1[0], P1[1], 14, 12), circ(P2[0], P2[1], 14, 12), dia(P0[0], P0[1], 22), dia(P3[0], P3[1], 22), seg2(-360, 290, 360, 290), seg2(-360, 290, -360, -290)];
  },
  cart: () => [[[-310, -230], [-220, -230], [-150, 120], [230, 120], [295, -130], [-190, -130]], circ(-100, 215, 36, 18), circ(190, 215, 36, 18), seg2(-120, -40, 250, -40)],
  chart: () => [
    seg2(-330, 260, 340, 260), seg2(-330, 260, -330, -280),
    rrect(-270, 90, 90, 150, 10, 3), rrect(-130, 10, 90, 230, 10, 3), rrect(10, -80, 90, 320, 10, 3), rrect(150, -170, 90, 410, 10, 3),
    [[-300, 20], [-130, -90], [20, -60], [280, -260]], [[210, -265], [280, -260], [262, -195]],
  ],
  cloud: () => [[...arc(-190, 50, 110, 90, 270), ...arc(-30, -50, 150, 200, 340), ...arc(180, 40, 120, 260, 450), [-190, 160]]],
  lock: () => [rrect(-210, -50, 420, 320, 44), [...arc(0, -50, 145, 180, 360), [145, -50]], seg2(-145, -50, -145, -60), circ(0, 80, 34, 16), seg2(0, 114, 0, 185)],
  chat: () => [rrect(-330, -240, 660, 400, 64), closed([[-190, 160], [-250, 280], [-80, 160]]), circ(-150, -40, 30, 14), circ(0, -40, 30, 14), circ(150, -40, 30, 14)],
  code: () => [[[-120, -170], [-310, 0], [-120, 170]], [[120, -170], [310, 0], [120, 170]], seg2(70, -240, -70, 240)],
  play: () => [circ(0, 0, 310, 48), closed([[-95, -160], [-95, 160], [180, 0]])],
  rocket: () => [
    closed([[0, -330], [95, -180], [95, 150], [-95, 150], [-95, -180]]),
    [[-95, 30], [-200, 200], [-95, 150]], [[95, 30], [200, 200], [95, 150]], circ(0, -70, 42, 18), [[-55, 170], [0, 310], [55, 170]],
  ],
  camera: () => [rrect(-330, -170, 660, 410, 52), [[-130, -170], [-90, -245], [90, -245], [130, -170]], circ(0, 40, 140, 36), circ(0, 40, 75, 24), circ(240, -100, 16, 10)],
  bolt: () => [closed([[50, -330], [-230, 40], [-20, 40], [-60, 330], [230, -60], [20, -60]])],
  gear: () => {
    const pts: Poly = [], n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 360, w = 360 / n;
      for (const [f, r] of [[0.0, 240], [0.18, 240], [0.26, 310], [0.5, 310], [0.58, 240]] as const) {
        const a = (a0 + f * w) * DEG;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    }
    pts.push(pts[0]);
    return [pts, circ(0, 0, 110, 30)];
  },
  pen: () => [closed([[0, -330], [175, -40], [95, 290], [-95, 290], [-175, -40]]), seg2(0, -330, 0, -80), circ(0, -40, 38, 16), seg2(-95, 210, 95, 210)],
  search: () => [circ(-60, -60, 210, 40), circ(-60, -60, 150, 32), seg2(95, 95, 300, 300), seg2(125, 70, 325, 270)],
  star: () => {
    const pts: Poly = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 140 : 320;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return [closed(pts)];
  },
  heart: () => {
    const pts: Poly = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * TAU;
      pts.push([19 * 16 * Math.sin(t) ** 3, -19 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) + 20]);
    }
    return [pts];
  },
  globe: () => [circ(0, 0, 310, 48), ellipse(0, 0, 310, 105), ellipse(0, 0, 125, 310), seg2(0, -310, 0, 310), ellipse(0, -170, 255, 40, 24), ellipse(0, 170, 255, 40, 24)],
  megaphone: () => [closed([[-290, -85], [-290, 85], [-120, 85], [210, 250], [210, -250], [-120, -85]]), [[-215, 85], [-170, 230], [-105, 230], [-125, 85]], arc(250, 0, 70, -60, 60)],
  shield: () => [closed([[0, -330], [265, -225], [245, 60], [0, 325], [-245, 60], [-265, -225]]), [[-115, 0], [-30, 95], [135, -95]]],
  layers: () => [
    closed([[-310, -120], [0, -250], [310, -120], [0, 10]]),
    [[-310, 0], [0, 130], [310, 0]],
    [[-310, 120], [0, 250], [310, 120]],
  ],
};

export const ICON_NAMES = ['brand', 'cube', ...Object.keys(ICONS)] as [string, ...string[]];

/** Wireframe cube, rotating with time. */
export function cubeIcon(t: number): Poly[] {
  const s = 215, a = t * 1.7, b = 0.55 + Math.sin(t * 1.3) * 0.2, V: Vec2[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const X = x * s, Y = y * s, Z = z * s;
    const X1 = X * Math.cos(a) + Z * Math.sin(a), Z1 = -X * Math.sin(a) + Z * Math.cos(a);
    const Y2 = Y * Math.cos(b) - Z1 * Math.sin(b), Z2 = Y * Math.sin(b) + Z1 * Math.cos(b), k = 1500 / (1500 + Z2);
    V.push([X1 * k, Y2 * k]);
  }
  return [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].map(([i, j]) => [V[i], V[j]]);
}

/** Spread `n` points evenly along the polylines' total length. */
export function resample(polys: Poly[], n: number): Vec2[] & { spacing: number } {
  const segs: Array<[Vec2, Vec2, number, number]> = [];
  let total = 0;
  for (const pl of polys)
    for (let i = 0; i < pl.length - 1; i++) {
      const a = pl[i], b = pl[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 0.01) {
        segs.push([a, b, total, L]);
        total += L;
      }
    }
  const out = [] as unknown as Vec2[] & { spacing: number };
  if (!segs.length) {
    for (let k = 0; k < n; k++) out.push([0, 0]);
    out.spacing = 1;
    return out;
  }
  let si = 0;
  for (let k = 0; k < n; k++) {
    const d = ((k + 0.5) / n) * total;
    while (si < segs.length - 1 && segs[si][2] + segs[si][3] < d) si++;
    const [a, b, s0, L] = segs[si], u = Math.min(1, Math.max(0, (d - s0) / L));
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  out.spacing = total / n;
  return out;
}
