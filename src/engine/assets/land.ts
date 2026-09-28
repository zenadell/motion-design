// World land dots for the globe technique. The data (≈3.7k points, 32 KB) is
// injected at boot only when a plan actually uses a globe.

import { DEG, type Vec3 } from '../core/math';

let raw: number[] = [];
let vecs: Vec3[] | null = null;

export function setLand(data: number[] | undefined): void {
  raw = data ?? [];
  vecs = null;
}

export const unit = (lat: number, lon: number): Vec3 => [
  Math.cos(lat * DEG) * Math.sin(lon * DEG),
  Math.sin(lat * DEG),
  Math.cos(lat * DEG) * Math.cos(lon * DEG),
];

export function landVectors(): Vec3[] {
  if (!vecs) {
    vecs = [];
    for (let i = 0; i + 1 < raw.length; i += 2) vecs.push(unit(raw[i] / 10, raw[i + 1] / 10));
  }
  return vecs;
}
