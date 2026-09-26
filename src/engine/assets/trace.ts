// Moore-neighbour contour tracing on a binary mask. Returns ordered boundary
// loops (outer shapes and holes) — used to turn rasterised glyphs into
// polylines that particles can flow along.

import type { Vec2 } from '../core/math';

export function traceContours(mask: Uint8Array, w: number, h: number, minLen = 12): Vec2[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  const isEdge = (x: number, y: number) => at(x, y) && (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1));
  const seen = new Uint8Array(w * h);
  // clockwise Moore neighbourhood starting west
  const NX = [-1, -1, 0, 1, 1, 1, 0, -1], NY = [0, -1, -1, -1, 0, 1, 1, 1];
  const out: Vec2[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !isEdge(x, y) || at(x - 1, y)) continue;
      const loop: Vec2[] = [];
      let cx = x, cy = y, dir = 0, guard = 0;
      do {
        loop.push([cx, cy]);
        seen[cy * w + cx] = 1;
        let found = false;
        for (let k = 0; k < 8; k++) {
          const d = (dir + 6 + k) % 8, nx = cx + NX[d], ny = cy + NY[d];
          if (at(nx, ny)) {
            cx = nx; cy = ny; dir = d; found = true;
            break;
          }
        }
        if (!found) break;
      } while ((cx !== x || cy !== y) && ++guard < w * h);
      if (loop.length >= minLen) {
        loop.push(loop[0]);
        out.push(loop);
      }
    }
  }
  return out;
}
