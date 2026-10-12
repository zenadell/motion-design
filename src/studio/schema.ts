import { z } from 'zod';

// The studio: a layer-and-keyframe composition format, like an After Effects
// comp. A model (or the reference measurer) fills in numbers — where a layer
// is, how big, how visible, and how it eases between keyframes — instead of
// writing drawing code. A plan plays a comp in a section with technique
// "comp:<id>". Everything is a pure function of time, like the rest of the
// engine.

const Num = z.number().finite();
export const Vec2Schema = z.tuple([Num, Num]);
const Vec4Schema = z.tuple([Num, Num, Num, Num]);

export const ROLES = ['bg', 'surface', 'text', 'muted', 'primary', 'secondary', 'accent', 'dark', 'light'] as const;
export type Role = (typeof ROLES)[number];
/** `#RRGGBB`, `#RRGGBBAA`, or a brand colour role (re-skins with the brand). */
export const ColorSchema = z.union([
  z.enum(ROLES),
  z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'a colour is "#RRGGBB", "#RRGGBBAA" or a role: ' + ROLES.join(', ')),
]);

export const EASE_NAMES = ['linear', 'hold', 'inCubic', 'outCubic', 'inOutCubic', 'outQuint', 'inExpo', 'outExpo', 'inOutExpo', 'outBack'] as const;
export type EaseName = (typeof EASE_NAMES)[number];
/**
 * How a value arrives at a keyframe from the one before: a name, a CSS-style
 * cubic-bezier [x1, y1, x2, y2], or a physical spring (overshoots when bouncy).
 */
export const EaseSchema = z.union([
  z.enum(EASE_NAMES),
  z.tuple([Num.min(0).max(1), Num.min(-2).max(3), Num.min(0).max(1), Num.min(-2).max(3)]),
  z.object({ spring: z.object({ stiffness: Num.min(1).max(4000), damping: Num.min(0).max(400) }) }),
]);
export type Ease = z.infer<typeof EaseSchema>;

function keyframe<T extends z.ZodType>(v: T) {
  return z.object({ t: Num, v, ease: EaseSchema.optional() });
}
/** A constant, or keyframes `[{ t, v, ease? }, …]` (times in the comp's units). */
export function prop<T extends z.ZodType>(v: T) {
  return z.union([v, z.array(keyframe(v)).min(1).max(600)]);
}

export type Vec2 = [number, number];
export type Color = z.infer<typeof ColorSchema>;
export interface Key<T> { t: number; v: T; ease?: Ease }
export type Prop<T> = T | Key<T>[];

const NumProp = prop(Num);
const Vec2Prop = prop(Vec2Schema);
const ColorProp = prop(ColorSchema);

export const GradientSchema = z.object({
  type: z.enum(['linear', 'radial']),
  /** Linear: from → to. Radial: centre `from`, radius = distance to `to`. Layer coordinates. */
  from: Vec2Schema,
  to: Vec2Schema,
  stops: z.array(z.tuple([Num.min(0).max(1), ColorSchema])).min(2).max(12),
});
export type Gradient = z.infer<typeof GradientSchema>;

export const StrokeSchema = z.object({
  color: ColorProp.optional(),
  width: NumProp.optional(),
  cap: z.enum(['butt', 'round', 'square']).optional(),
  join: z.enum(['miter', 'round', 'bevel']).optional(),
  dash: z.array(Num.min(0)).max(8).optional(),
});

/** Draw only part of a stroke: 0..1 along its length (line-drawing reveals). */
export const TrimSchema = z.object({ start: NumProp.optional(), end: NumProp.optional(), offset: NumProp.optional() });

export const UnitStateSchema = z.object({
  opacity: Num.min(0).max(1).optional(),
  x: Num.optional(),
  y: Num.optional(),
  scale: Num.optional(),
  rotation: Num.optional(),
  blur: Num.min(0).optional(),
});
export type UnitState = z.infer<typeof UnitStateSchema>;

/** An After Effects style text animator: each char / word / line moves in from `from` (and out to `exit.to`). */
export const TextAnimatorSchema = z.object({
  by: z.enum(['char', 'word', 'line']).optional(),
  start: Num.optional(),
  duration: Num.min(0).optional(),
  stagger: Num.min(0).optional(),
  ease: EaseSchema.optional(),
  order: z.enum(['forward', 'reverse', 'center', 'random']).optional(),
  from: UnitStateSchema.optional(),
  /** Clip each line so units rise out of (or sink into) their baseline. */
  mask: z.boolean().optional(),
  exit: z.object({
    start: Num,
    duration: Num.min(0).optional(),
    stagger: Num.min(0).optional(),
    ease: EaseSchema.optional(),
    order: z.enum(['forward', 'reverse', 'center', 'random']).optional(),
    to: UnitStateSchema.optional(),
  }).optional(),
});
export type TextAnimator = z.infer<typeof TextAnimatorSchema>;

export const BLENDS = ['normal', 'add', 'screen', 'multiply', 'overlay', 'difference', 'lighten', 'darken'] as const;

const base = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'letters, digits, "-" or "_", up to 40'),
  name: z.string().max(80).optional(),
  /** Visible from `in` to `out` (comp time). */
  in: Num.optional(),
  out: Num.optional(),
  /** Inherit another layer's transform (same layer list); draw order is unchanged. */
  parent: z.string().optional(),
  /** Where the layer's origin sits (default: frame centre [960, 540]). */
  position: Vec2Prop.optional(),
  /** Pivot, in layer coordinates (default [0, 0] = the centre of the content). */
  anchor: Vec2Prop.optional(),
  scale: prop(z.union([Num, Vec2Schema])).optional(),
  /** Degrees, clockwise. */
  rotation: NumProp.optional(),
  /** Degrees of horizontal skew. */
  skew: NumProp.optional(),
  opacity: NumProp.optional(),
  /** Depth for the comp camera: 0 is the focal plane, positive is further away (smaller, slower parallax). */
  z: NumProp.optional(),
  /** Gaussian blur in px. */
  blur: NumProp.optional(),
  glow: z.object({ color: ColorProp.optional(), radius: NumProp.optional(), strength: NumProp.optional() }).optional(),
  shadow: z.object({ color: ColorProp.optional(), blur: NumProp.optional(), x: NumProp.optional(), y: NumProp.optional() }).optional(),
  blend: z.enum(BLENDS).optional(),
  /** Show this layer only through (or outside) another layer's pixels. The matte layer itself is not drawn. */
  matte: z.object({ layer: z.string(), invert: z.boolean().optional() }).optional(),
  /** Clip to a rectangle [x, y, w, h] in layer coordinates (wipes and reveals). */
  clip: prop(Vec4Schema).optional(),
  /** Ignore the comp camera (overlays). */
  fixed: z.boolean().optional(),
};

const fill = z.union([ColorProp, GradientSchema]);

const TextLayer = z.object({
  ...base,
  type: z.literal('text'),
  text: z.string().min(1).max(400),
  /** A role (display, serif, mono) or a font family from the registry. */
  font: z.string().optional(),
  size: NumProp.optional(),
  weight: Num.min(100).max(1000).optional(),
  italic: z.boolean().optional(),
  color: fill.optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  /** Letter spacing in em. */
  tracking: NumProp.optional(),
  lineHeight: Num.min(0.5).max(4).optional(),
  stroke: StrokeSchema.optional(),
  animate: TextAnimatorSchema.optional(),
});

const RectLayer = z.object({
  ...base,
  type: z.literal('rect'),
  size: Vec2Prop,
  radius: NumProp.optional(),
  fill: fill.optional(),
  stroke: StrokeSchema.optional(),
  trim: TrimSchema.optional(),
});

const EllipseLayer = z.object({
  ...base,
  type: z.literal('ellipse'),
  size: Vec2Prop,
  fill: fill.optional(),
  stroke: StrokeSchema.optional(),
  trim: TrimSchema.optional(),
});

const PathLayer = z.object({
  ...base,
  type: z.literal('path'),
  /** SVG path data, in layer coordinates. */
  d: z.string().min(1).max(60_000),
  fill: fill.optional(),
  stroke: StrokeSchema.optional(),
  trim: TrimSchema.optional(),
});

const LineLayer = z.object({
  ...base,
  type: z.literal('line'),
  from: Vec2Prop,
  to: Vec2Prop,
  stroke: StrokeSchema.optional(),
  trim: TrimSchema.optional(),
});

const ImageLayer = z.object({
  ...base,
  type: z.literal('image'),
  /** "asset:<id>" (from studio.assets) or a data: URL. */
  src: z.string().min(1),
  /** Drawn size in px (default: the image's own size). */
  size: Vec2Prop.optional(),
});

const LogoLayer = z.object({
  ...base,
  type: z.literal('logo'),
  /** Height of the mark in px. */
  size: NumProp.optional(),
  color: ColorProp.optional(),
  tile: z.boolean().optional(),
});

const TechniqueLayer = z.object({
  ...base,
  type: z.literal('technique'),
  /** A technique id from the library, drawn as a full frame that the layer transforms. */
  technique: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  /** Comp time at which the technique's own clock starts, and its length in beats. */
  start: Num.optional(),
  beats: Num.min(0.25).max(64).optional(),
});

const CodeLayer = z.object({
  ...base,
  type: z.literal('code'),
  /** Body of function (g, t, S): draw this element in layer coordinates at comp time t (Stage API). */
  draw: z.string().min(1).max(30_000),
});

export interface GroupLayer extends z.infer<z.ZodObject<typeof base>> {
  type: 'group';
  layers: Layer[];
  time?: { offset?: number; speed?: number; loop?: number };
}
const GroupLayer: z.ZodType<GroupLayer> = z.object({
  ...base,
  type: z.literal('group'),
  /** Children are drawn in the group's coordinates and share its opacity. */
  get layers() { return z.array(LayerSchema).max(400); },
  /** Re-time the children: their time = (t - offset) × speed, wrapped by loop if given. */
  time: z.object({ offset: Num.optional(), speed: Num.optional(), loop: Num.min(0.01).optional() }).optional(),
}) as z.ZodType<GroupLayer>;

export type TextLayer = z.infer<typeof TextLayer>;
export type RectLayer = z.infer<typeof RectLayer>;
export type EllipseLayer = z.infer<typeof EllipseLayer>;
export type PathLayer = z.infer<typeof PathLayer>;
export type LineLayer = z.infer<typeof LineLayer>;
export type ImageLayer = z.infer<typeof ImageLayer>;
export type LogoLayer = z.infer<typeof LogoLayer>;
export type TechniqueLayer = z.infer<typeof TechniqueLayer>;
export type CodeLayer = z.infer<typeof CodeLayer>;
export type Layer = TextLayer | RectLayer | EllipseLayer | PathLayer | LineLayer | ImageLayer | LogoLayer | TechniqueLayer | CodeLayer | GroupLayer;
export const LAYER_TYPES = ['text', 'rect', 'ellipse', 'path', 'line', 'image', 'logo', 'technique', 'code', 'group'] as const;

export const LayerSchema: z.ZodType<Layer> = z.discriminatedUnion('type', [
  TextLayer, RectLayer, EllipseLayer, PathLayer, LineLayer, ImageLayer, LogoLayer, TechniqueLayer, CodeLayer,
  GroupLayer as unknown as z.ZodObject<{ type: z.ZodLiteral<'group'> }>,
]) as unknown as z.ZodType<Layer>;

export const SOUNDS = ['whoosh', 'impact', 'pop', 'click', 'shing', 'riser', 'blip', 'crash', 'clap', 'kick', 'zip', 'swell'] as const;

export const CompSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'lowercase id like "hero-title"'),
  title: z.string().max(60).optional(),
  /** Unit of every time in this comp (keyframes, in/out, animators). Beats follow the plan's BPM. */
  units: z.enum(['seconds', 'beats']).default('seconds'),
  /** Fill behind every layer (default: the brand background). */
  background: ColorProp.optional(),
  camera: z.object({
    /** The point of the comp the camera looks at (default [960, 540]). */
    position: Vec2Prop.optional(),
    zoom: NumProp.optional(),
    rotation: NumProp.optional(),
    /** Dolly: move the camera toward (positive) the layers; layers with depth `z` react with parallax. */
    z: NumProp.optional(),
  }).optional(),
  /** Bottom to top: later layers draw over earlier ones. */
  layers: z.array(LayerSchema).max(400),
  hits: z.array(z.object({ t: Num, shake: Num.min(0).max(40).default(10), punch: Num.min(0).max(0.2).optional() })).max(32).default([]),
  sounds: z.array(z.object({ t: Num, sound: z.enum(SOUNDS), gain: Num.min(0).max(2).optional(), duration: Num.min(0.05).max(8).optional() })).max(64).default([]),
});
export type Comp = z.output<typeof CompSchema>;
export type CompInput = z.input<typeof CompSchema>;

export const StudioSchema = z.object({
  comps: z.array(CompSchema).max(24).default([]),
  /** Images the comps use as "asset:<id>": data URLs (PNG, JPEG, WebP, SVG). */
  assets: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), z.string().regex(/^data:image\//, 'a data:image/… URL')).default({}),
});
export type Studio = z.output<typeof StudioSchema>;
