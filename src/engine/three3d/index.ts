// Entry of the optional 3D bundle (dist/three.js): window.Motion3D.create(ctx)
// → { THREE, view, logo3d, type3d, shapes3d }. The 2D engine looks it up at
// runtime (S.three, S.set.logo3d …), so reels without 3D never load it.

import type { Ctx3D } from './kit';
import { setPieces3D } from './setpieces3d';

let api: ReturnType<typeof setPieces3D> | null = null;
(window as unknown as { Motion3D: unknown }).Motion3D = {
  create(ctx: Ctx3D) {
    return (api ??= setPieces3D(ctx));
  },
};
