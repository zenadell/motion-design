// A canvas `filter = 'blur(…)'` makes Chromium's CPU renderer blur a layer the
// size of the whole canvas for every draw call: a blurred word costs ~33 ms at
// 1920×1080, the same as blurring the full frame. Clipping the draw to its own
// bounds (grown by the blur's reach) bounds that layer: ~2 ms, same pixels.
// Scene code written by models blurs word by word, so this is installed once
// for every 2D context on the page.

const SAFE = /^(\s*(blur|brightness|contrast|saturate|opacity|grayscale|hue-rotate|invert|sepia)\([^)]*\)\s*)+$/;

/** How far a filter spreads a draw, in px (undefined: unbounded or not worth clipping). */
export function filterReach(filter: string): number | undefined {
  if (!filter || filter === 'none' || !SAFE.test(filter)) return undefined;
  let r = 0;
  for (const m of filter.matchAll(/blur\(\s*([\d.]+)(px)?\s*\)/g)) r = Math.max(r, Number(m[1]) || 0);
  // blur(r) is a Gaussian with σ = r: 3σ holds all but a fraction of a grey level
  return r > 0.5 ? r * 3 + 4 : undefined;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Rect = [number, number, number, number];

/** Run `draw` clipped to the user-space rect grown by the filter's reach (and any shadow), in device space. */
function clipped(g: Ctx, rect: Rect, pad: number, draw: () => void): void {
  const m = g.getTransform();
  const [x, y, w, h] = rect;
  const xs: number[] = [], ys: number[] = [];
  for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    xs.push(m.a * px + m.c * py + m.e);
    ys.push(m.b * px + m.d * py + m.f);
  }
  const scale = Math.max(1, Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  const sp = g.shadowColor && g.shadowColor !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(g.shadowColor) ? g.shadowBlur * 2 + Math.max(Math.abs(g.shadowOffsetX), Math.abs(g.shadowOffsetY)) : 0;
  const p = pad * scale + sp;
  const x0 = Math.floor(Math.min(...xs) - p), y0 = Math.floor(Math.min(...ys) - p);
  const x1 = Math.ceil(Math.max(...xs) + p), y1 = Math.ceil(Math.max(...ys) + p);
  if (!Number.isFinite(x0 + y0 + x1 + y1)) return draw();
  // a Path2D clip: the caller's current path stays as it was
  const box = new Path2D();
  box.rect(x0, y0, x1 - x0, y1 - y0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clip(box);
  g.setTransform(m);
  draw();
  g.restore();
}

const sizeOf = (img: CanvasImageSource): [number, number] => {
  const i = img as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  const w = i.naturalWidth || i.videoWidth || i.displayWidth || (typeof i.width === 'number' ? i.width : i.width?.baseVal.value) || 0;
  const h = i.naturalHeight || i.videoHeight || i.displayHeight || (typeof i.height === 'number' ? i.height : i.height?.baseVal.value) || 0;
  return [w, h];
};

/** The text's ink box, generously (a maxWidth squeeze only makes the real one smaller). */
function textRect(g: Ctx, text: string, x: number, y: number): Rect {
  const t = g.measureText(text);
  const ls = Math.abs(parseFloat(String((g as { letterSpacing?: string }).letterSpacing ?? '0')) || 0) * text.length;
  const left = t.actualBoundingBoxLeft + ls, right = t.actualBoundingBoxRight + ls;
  const extra = g.lineWidth;
  return [x - left - extra, y - t.actualBoundingBoxAscent - extra, left + right + 2 * extra, t.actualBoundingBoxAscent + t.actualBoundingBoxDescent + 2 * extra];
}

let installed = false;

export function installFastFilter(): void {
  if (installed) return;
  installed = true;
  const protos = [globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean) as Ctx[];
  for (const P of protos) {
    const fillText = P.fillText, strokeText = P.strokeText, drawImage = P.drawImage as (...a: unknown[]) => void, fillRect = P.fillRect, strokeRect = P.strokeRect;
    P.fillText = function (this: Ctx, text: string, x: number, y: number, maxWidth?: number) {
      const reach = filterReach(this.filter);
      const go = () => (maxWidth === undefined ? fillText.call(this, text, x, y) : fillText.call(this, text, x, y, maxWidth));
      if (reach === undefined) return go();
      clipped(this, textRect(this, String(text), x, y), reach, go);
    };
    P.strokeText = function (this: Ctx, text: string, x: number, y: number, maxWidth?: number) {
      const reach = filterReach(this.filter);
      const go = () => (maxWidth === undefined ? strokeText.call(this, text, x, y) : strokeText.call(this, text, x, y, maxWidth));
      if (reach === undefined) return go();
      clipped(this, textRect(this, String(text), x, y), reach, go);
    };
    P.drawImage = function (this: Ctx, ...a: unknown[]) {
      const reach = filterReach(this.filter);
      if (reach === undefined || !(a.length === 3 || a.length === 5 || a.length === 9)) return drawImage.apply(this, a);
      const n = a as [CanvasImageSource, ...number[]];
      const rect: Rect = a.length === 3 ? [n[1], n[2], ...sizeOf(n[0])] : a.length === 5 ? [n[1], n[2], n[3], n[4]] : [n[5], n[6], n[7], n[8]];
      // an image of unknown size is drawn as it is
      if (a.length === 3 && !(rect[2] > 0 && rect[3] > 0)) return drawImage.apply(this, a);
      clipped(this, rect, reach, () => drawImage.apply(this, a));
    } as typeof P.drawImage;
    P.fillRect = function (this: Ctx, x: number, y: number, w: number, h: number) {
      const reach = filterReach(this.filter);
      if (reach === undefined) return fillRect.call(this, x, y, w, h);
      clipped(this, [x, y, w, h], reach, () => fillRect.call(this, x, y, w, h));
    };
    P.strokeRect = function (this: Ctx, x: number, y: number, w: number, h: number) {
      const reach = filterReach(this.filter);
      if (reach === undefined) return strokeRect.call(this, x, y, w, h);
      const lw = this.lineWidth;
      clipped(this, [x - lw, y - lw, w + 2 * lw, h + 2 * lw], reach, () => strokeRect.call(this, x, y, w, h));
    };
  }
}
