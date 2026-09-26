import type { G } from './draw';
import { H, W } from './draw';
import { DEG, lerp } from './math';

/** A pinhole camera with yaw → pitch → roll order, pre-computed trig. */
export interface Cam {
  x: number; y: number; z: number;
  yaw: number; pitch: number; roll: number;
  f: number; fov: number;
  cy: number; sy: number; cp: number; sp: number; cr: number; sr: number;
}

export const NEAR = 30;

export function makeCam(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, fovDeg: number): Cam {
  const fov = fovDeg * DEG;
  return {
    x, y, z, yaw, pitch, roll, fov, f: H / 2 / Math.tan(fov / 2),
    cy: Math.cos(-yaw), sy: Math.sin(-yaw), cp: Math.cos(-pitch), sp: Math.sin(-pitch), cr: Math.cos(-roll), sr: Math.sin(-roll),
  };
}

/** Camera orbiting the origin, always looking at it. Angles in degrees. */
export function orbitCam(yawD: number, pitchD: number, D: number, fovD = 30): Cam {
  const y = yawD * DEG, p = pitchD * DEG;
  return makeCam(D * Math.sin(y) * Math.cos(p), D * Math.sin(p), -D * Math.cos(y) * Math.cos(p), -y, -p, 0, fovD);
}

/** World → camera space. Returns [x, y, depth]. */
export function proj(cam: Cam, X: number, Y: number, Z: number): [number, number, number] {
  const x = X - cam.x, y = Y - cam.y, z = Z - cam.z;
  const x1 = x * cam.cy + z * cam.sy, z1 = -x * cam.sy + z * cam.cy;
  const y2 = y * cam.cp + z1 * cam.sp, z2 = -y * cam.sp + z1 * cam.cp;
  return [x1 * cam.cr - y2 * cam.sr, x1 * cam.sr + y2 * cam.cr, z2];
}

export const scr = (cam: Cam, v: [number, number, number]): [number, number] => [W / 2 + (cam.f * v[0]) / v[2], H / 2 - (cam.f * v[1]) / v[2]];

export function clipNear(p: [number, number, number], q: [number, number, number]): [number, number, number] {
  const k = (NEAR - p[2]) / (q[2] - p[2]);
  return [lerp(p[0], q[0], k), lerp(p[1], q[1], k), NEAR];
}

/** Add a near-clipped 3D segment (camera space) to a 2D path. */
export function seg(path: Path2D | G, cam: Cam, a: [number, number, number], b: [number, number, number]): void {
  if (a[2] < NEAR && b[2] < NEAR) return;
  if (a[2] < NEAR) a = clipNear(a, b);
  else if (b[2] < NEAR) b = clipNear(b, a);
  const A = scr(cam, a), B = scr(cam, b);
  path.moveTo(A[0], A[1]);
  path.lineTo(B[0], B[1]);
}

/**
 * Map a plane's local 2D coordinates onto screen with an affine transform
 * built from three projected points. Good enough for long lenses; lets any
 * 2D drawing code (text, UI) live on a 3D card.
 */
export function planeXform(g: G, cam: Cam, O: number[], UX: number[], UY: number[]): boolean {
  const o = proj(cam, O[0], O[1], O[2]);
  const px = proj(cam, O[0] + UX[0], O[1] + UX[1], O[2] + UX[2]);
  const py = proj(cam, O[0] + UY[0], O[1] + UY[1], O[2] + UY[2]);
  if (o[2] < NEAR * 4 || px[2] < NEAR * 4 || py[2] < NEAR * 4) return false;
  const so = scr(cam, o), sx = scr(cam, px), sy = scr(cam, py);
  g.transform(sx[0] - so[0], sx[1] - so[1], sy[0] - so[0], sy[1] - so[1], so[0], so[1]);
  return true;
}
