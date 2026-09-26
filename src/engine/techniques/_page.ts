// Shared "page in 3D space" helpers for the editor / exploded-UI scenes.
import { orbitCam, planeXform, type Cam } from '../core/camera';
import type { G } from '../core/draw';

export const PW = 1280;
export const PH = 760;
export const pageOrigin = (z: number): number[] => [-PW / 2, PH / 2, z];
export const FRONT: [number, number, number] = [0, 0, 2150];

/** Map page-local coordinates (0..PW, 0..PH) onto a plane at depth z. */
export function onPage(g: G, cam: Cam, z: number): boolean {
  return planeXform(g, cam, pageOrigin(z), [1, 0, 0], [0, -1, 0]);
}

export function frontCam(): Cam {
  return orbitCam(FRONT[0], FRONT[1], FRONT[2]);
}

/** Screen rectangle the page occupies when seen from the front camera. */
export function frontRect(): { x: number; y: number; w: number; h: number } {
  const cam = frontCam(), s = cam.f / FRONT[2];
  return { x: 960 - (PW * s) / 2, y: 540 - (PH * s) / 2, w: PW * s, h: PH * s };
}
