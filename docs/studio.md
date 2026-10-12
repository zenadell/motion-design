# Studio: layers and keyframes

The studio is the engine's After Effects. A **comp** is a stack of layers, and every property can be a constant or keyframes with an ease. A model, the reference measurer or a person fills in numbers instead of writing drawing code. A plan plays a comp in a section with `"technique": "comp:<id>"`, so comps sit next to library techniques and code scenes, with transitions, music and rendering working as usual.

```jsonc
{
  "sections": [{ "technique": "comp:hero", "beats": 8 }],
  "studio": {
    "comps": [{
      "id": "hero", "units": "beats",
      "camera": { "zoom": [{ "t": 0, "v": 1.1 }, { "t": 8, "v": 1 }] },
      "layers": [
        { "id": "card", "type": "rect", "size": [900, 420], "radius": 36, "fill": "surface",
          "scale": [{ "t": 0, "v": 0.6 }, { "t": 1, "v": 1, "ease": { "spring": { "stiffness": 220, "damping": 16 } } }] },
        { "id": "title", "type": "text", "text": "SHIP FASTER", "size": 120, "parent": "card",
          "animate": { "by": "char", "start": 0.5, "stagger": 0.05, "from": { "opacity": 0, "y": 60, "blur": 10 } } }
      ]
    }],
    "assets": { "shot": "data:image/png;base64,…" }
  }
}
```

## Time, keyframes and eases

- `units`: `"seconds"` (default) or `"beats"`, which follow the plan's BPM. Every time in the comp uses this unit: keyframes, `in`/`out`, animator `start`, `stagger` and `duration`, and `hits`/`sounds`.
- A property is a constant (`"opacity": 0.5`) or keyframes `[{ "t": 0, "v": 0 }, { "t": 1, "v": 1, "ease": "outExpo" }]`. Keys are sorted by time automatically. Before the first key the value holds the first value; after the last it holds the last.
- A key's `ease` is how the value **arrives at that key** from the previous one (default `inOutCubic`):
  - names: `linear`, `hold` (jump at the key), `inCubic`, `outCubic`, `inOutCubic`, `outQuint`, `inExpo`, `outExpo`, `inOutExpo`, `outBack`
  - a cubic-bezier `[x1, y1, x2, y2]`, as in CSS and After Effects
  - a spring `{ "spring": { "stiffness": 180, "damping": 14 } }`. It runs on real time and overshoots when the damping is low.
- Values are numbers, `[x, y]` pairs, or colours. Colours are `#RRGGBB`, `#RRGGBBAA`, or a brand role: `bg`, `surface`, `text`, `muted`, `primary`, `secondary`, `accent`, `dark`, `light`. A comp written with roles re-skins with the brand.

## Layers

Layers draw bottom to top, so later layers are on top. Every layer has these fields:

| field | meaning |
|---|---|
| `id` | unique in the comp |
| `in`, `out` | visible from `in` to `out` |
| `position` | where the layer's origin sits; default `[960, 540]`, the frame centre |
| `anchor` | pivot in layer coordinates; default `[0, 0]`, the centre of the content |
| `scale` | number or `[sx, sy]` |
| `rotation`, `skew` | degrees |
| `opacity` | 0–1 |
| `parent` | another layer's id in the same list. The layer inherits its transform; draw order and opacity are not inherited |
| `z` | depth for the comp camera: 0 is the focal plane, positive is further away (smaller, slower parallax) |
| `blur` | px |
| `glow` | `{ color, radius, strength }` |
| `shadow` | `{ color, blur, x, y }` |
| `blend` | `normal`, `add`, `screen`, `multiply`, `overlay`, `difference`, `lighten`, `darken` |
| `matte` | `{ "layer": "id", "invert": false }`: show this layer only through (or outside) another layer's pixels. The matte layer is not drawn on its own |
| `clip` | `[x, y, w, h]` in layer coordinates (wipes and reveals) |
| `fixed` | ignore the comp camera |

Each layer type adds these fields:

| `type` | fields |
|---|---|
| `text` | `text` (`\n` for lines), `font` (`display`, `serif`, `mono` or a registry family), `size`, `weight`, `italic`, `color` (colour or gradient), `align` (`left`, `center`, `right`), `tracking` (em), `lineHeight`, `stroke`, `animate`. Position is the centre of the text block |
| `rect` | `size: [w, h]` (centred), `radius`, `fill` (colour or gradient), `stroke`, `trim` |
| `ellipse` | `size: [w, h]`, `fill`, `stroke`, `trim` |
| `path` | `d` (SVG path data in frame coordinates; position defaults to `[0, 0]`), `fill`, `stroke`, `trim` |
| `line` | `from`, `to` (frame coordinates), `stroke`, `trim` |
| `image` | `src` (`"asset:<id>"` or a `data:image/…` URL), `size` (default: the image's size) |
| `logo` | the brand mark: `size` (height in px), `color`, `tile` |
| `technique` | a library technique as a layer: `technique`, `params`, `start` (comp time its clock starts), `beats`. It draws a full frame that the layer transforms, so it can be scaled, matted or blended |
| `code` | `draw`: the body of `function (g, t, S)` with the Stage API from `docs/stage-api.md`. It draws in frame coordinates at comp time `t`. Use it for the one element keyframes can't express |
| `group` | `layers`: children in the group's frame-sized coordinates; they share its transform and opacity. `time: { offset, speed, loop }` re-times the children |

- **Fills:** a colour, or `{ "type": "linear" | "radial", "from": [x, y], "to": [x, y], "stops": [[0, "primary"], [1, "#00000000"]] }` in layer coordinates.
- **Strokes:** `{ "color", "width", "cap", "join", "dash" }`. `trim: { "start", "end", "offset" }` (0–1) draws part of the stroke, for line-drawing reveals.
- **Text animators:** `animate: { by: "char" | "word" | "line", start, duration (0.5), stagger (0.04), ease ("outExpo"), order: "forward" | "reverse" | "center" | "random", from: { opacity, x, y, scale, rotation, blur }, mask, exit: { start, duration, stagger, ease, to: {…} } }`. Each unit moves from `from` to rest, and later to `exit.to`. `mask` clips every line, so units rise out of their baseline.

## Camera, hits and sound

- `camera: { position, zoom, rotation, z }`. `position` is the point of the comp the camera looks at. `z` dollies the camera: positive moves it toward the layers, and layers with a larger `z` react less (parallax).
- `hits: [{ t, shake, punch }]` adds camera shake and zoom punch, like the library techniques.
- `sounds: [{ t, sound, gain, duration }]` takes a `sound` from `whoosh`, `impact`, `pop`, `click`, `shing`, `riser`, `blip`, `crash`, `clap`, `kick`, `zip` or `swell`. The music bed plays under the comp as usual (set the section's `energy`).

## Editing operations (`motion studio apply`, MCP `studio_apply`)

A batch is applied in order, all or nothing:

| op | fields |
|---|---|
| `add_comp` | `comp` (at least `id`) |
| `remove_comp` | `comp` |
| `set_comp` | `comp`, `set` (units, background, camera, hits, sounds; `null` removes a field) |
| `add_layer` | `comp`, `layer`, `index?`, `group?` |
| `update_layer` | `comp`, `layer`, `set` (shallow merge; `null` removes a field) |
| `remove_layer` | `comp`, `layer` |
| `move_layer` | `comp`, `layer`, `index` |
| `keyframe` | `comp`, `layer?`, `prop` (dotted, e.g. `position`, `stroke.width`, `camera.zoom` when there is no layer), `t`, `v`, `ease?`. Adds or replaces the key at `t`. A constant becomes keyframes |
| `remove_keyframe` | `comp`, `layer?`, `prop`, `t` |
| `add_asset` | `id`, `data` (a `data:image/…` URL) |
| `set_sections` | `sections` (the plan's timeline) |
| `set` | `path` (dotted, from the plan root), `value` |

`motion studio describe plan.json` prints one line per section and layer. Agents read that summary instead of the JSON.

## Driving the studio from an agent (MCP)

`motion studio mcp [plan.json]` serves these tools over stdio:

| tool | what it does |
|---|---|
| `studio_docs` | returns this reference |
| `studio_open` | opens or creates a plan |
| `studio_describe` | the one-line-per-layer summary |
| `studio_apply` | edits with the operations above, then saves and validates |
| `studio_frame` | renders a frame (JPEG) |
| `studio_compare` | SSIM against a reference film at a time, plus a side-by-side image |
| `studio_measure` | measures a reference into a comp |
| `studio_render` | renders the MP4 |

To connect an agent:

```bash
npm run build
claude mcp add motion-studio -- node "$PWD/dist/cli.js" studio mcp            # Claude Code
```

Any other MCP client (Gemini CLI, Codex, a custom DeepSeek or Gemini loop) runs the command `node dist/cli.js studio mcp` over stdio. The usual loop is:

1. measure the reference;
2. compare frames where it differs;
3. replace or fix layers;
4. compare again;
5. render.

## Copying a film by measuring it

`motion studio copy reference.mp4 -o out/copy` (or MCP `studio_measure`) needs no model:

1. **Shots:** hard cuts split the film.
2. **Background:** each frame gets a smooth colour surface fitted to it, so gradients and vignettes count as background. A flat background becomes the comp's `background`, keyed through colour changes. A gradient becomes a plate image per shot.
3. **Elements:** connected regions that differ from the background, with letters of a word joined. They are tracked across frames.
4. **Motion:** each element either *transforms* (it moves and scales as a whole, which gives `position` and `scale` keys from its weighted centroid and spread) or is *revealed* in place (typewriters, wipes, staggered letters, which give `clip` keys). Its `opacity` comes from its energy against its fullest frame, including fades too faint to see. An element entering from off screen is measured from its visible edge.
5. **Keyframes:** every curve becomes the fewest keys within tolerance (1.5 px for position). Each segment gets the best of the named eases, about 500 cubic-beziers and 35 springs.
6. **Sprites:** each element is cut out of its fullest frame at 1920×1080, with the background model keyed away. Partly transparent edges keep their true colour.

The copy plays at once and has the reference's soundtrack. `compare.mp4` puts them side by side, and the SSIM score is written to `measure.txt`. The comp is an ordinary comp, so it can be adapted: replace a sprite with a `text` layer in the brand's words, or with the `logo`, and keep the measured keyframes.

7. **Do no harm:** for every frame, each element is checked: does its sprite, placed with the measured motion and composited on the background, match the reference better than the background alone? It is kept only for the stretches where it does. A mis-tracked element, or one whose content changes, is left out rather than drawn in the wrong place.

### Measured fidelity

These are two films rendered by this engine and copied with no model. SSIM is computed over every frame at 24 fps (1 = identical). "Background only" is the same copy with every element removed, which shows how much the measured elements add.

| reference | length | background only | measured copy | time (4 CPUs) |
|---|---|---|---|---|
| `examples/studio-demo.plan.json`: ring draw-on, springy per-letter title with blur, matte wipe, glow, glitch layer, end card | 7 s, 1 shot | 0.892 | **0.935** | ~2 min |
| `examples/resume-reel.plan.json`: 13 shots, kinetic type, a 3D portal, a 150-dot grid, colour studies | 15 s, 13 shots | 0.762 | **0.796** | ~4 min |

Type, cards, logos, colour fields and anything that moves, scales, rotates, fades or wipes come back closely. These come back poorly:

- letters mid-entrance when they also blur or rotate (they appear at rest);
- content that changes inside one element ("TYPE" becoming "FORM");
- strokes that draw on;
- particles and dense grids (the element budget is 150);
- 3D.

These are the jobs for a refine loop. An agent compares the copy with the reference (`studio_compare`), then replaces those spots with `text` animators, `trim`, `technique` or `code` layers.

**Limits:** 16:9 films up to 32 s per copy. Static elements that never change can merge with the background plate. Elements that cross or merge with each other are tracked as one. Particles, morphs and 3D rotation are measured as sprites that move, not as what they are; a model can replace those with `technique` or `code` layers.
