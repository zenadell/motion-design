# Motion craft handbook

What separates a $100k studio film from a template. The invent pipeline gives this to the model as its standard, when directing, when coding and when judging.

## 1. The bar

- **One idea, fully committed.** A single visual system (a material, a behaviour, a metaphor) runs through every shot, so the film feels authored. Variety comes from how that idea is staged, not from switching ideas.
- **Every frame is a poster.** Pause anywhere and the frame has a clear focal point, a considered composition and something worth looking at. Dead frames are the most common amateur tell.
- **Obsessive timing.** Everything that matters lands on the music. Nothing moves at constant speed unless it is a deliberate drift.
- **Contrast everywhere.** Big against small, fast against held, dense against empty, dark against a flash of colour. Sameness kills energy.
- **Picture and sound are one thing.** Every cut, impact and entrance has a sound, and the music's structure (build, drop, breath, resolve) is the film's structure.

## 2. Rhythm and timing (120 BPM: a beat is 0.5 s, a bar 2 s)

- **Energy sections:** something changes at least every beat (a cut, a hit, an entrance, a camera accent). Peaks cut on the 8ths (0.25 s).
- **Hold key messages** for 1–2 beats, fully legible, before they move again. The pattern is **impact → hold → release**.
- **Anticipation:** a 2–4 frame wind-up (a slight pull back, a squash) before a big move sells it. Overshoot 5–10 % and settle.
- **Syncopation:** not everything on the downbeat. Off-beat accents (the "and") feel alive.
- **Energy curve:** hook (high, the first second is the strongest frame) → build → peak → breath (one calm moment) → resolve on the brand. The logo lands on a downbeat after a beat of near-silence.
- **Stagger:** 20–50 ms per letter and 60–120 ms per word. Order by position, from the centre, or random for chaos.

## 3. Easing

- **Entrances:** expo or quint out (fast, then a long settle).
- **Exits:** expo in (a slow start, then gone).
- **Camera moves and transforms that start and stop:** inOutCubic or inOutExpo.
- **Playful or physical things:** springs (a bounce with real physics).
- **Linear** only for continuous drifts, rotations and scrolling textures.
- **Never ease everything the same way.** Mix a snappy primary move with a slower secondary follow-through (the shadow, the echo, the label that arrives 60 ms late).

## 4. Composition

- **Fill the frame deliberately.** Negative space must be designed (a single giant word on a flat field), never accidental (a small object in a dark void).
- **Scale contrast:** hero type is 160–400 px. Supporting labels are 14–22 px mono with wide tracking. Nothing in between competes.
- **Depth:** a background (texture, gradient, light), a midground (shapes, systems), a foreground (type, the hero object) and an overlay (grain, light leaks, vignette). Parallax between layers sells space.
- Keep text inside a 90 px safe margin. Centre, thirds or a strict grid are all fine, as long as it's intentional.
- **Full-bleed moments:** at least one frame every 4–6 s where colour or a shape fills the screen edge to edge.

## 5. Typography

- **Type is image.** Big, bold and tight for hero words (tracking −2 to −4 %). Small caps labels are wide (+20 to +40 %).
- **One or two families.** Contrast comes from weight (200 vs 800), size and case, not from more fonts.
- **Kinetic vocabulary:**
  - mask reveals (letters rise out of a baseline);
  - per-letter stagger with blur;
  - scale slams;
  - outline → fill;
  - slice and split;
  - stretch and squash on impact;
  - word swaps on the beat;
  - type as texture (repeated, scrolling, huge and cropped).
- **Readability:** every word you want read is fully on screen, unoccluded and high-contrast, for at least 0.6 s.

## 6. Colour and light

- **60/30/10:** a dominant field, a supporting tone and one accent used sparingly (the brand colour hits harder when it's rare).
- **Punctuation:** a full-screen colour flash or field on a key beat.
- **Light is additive.** Glows, bloom and light sweeps use 'lighter' blending. A dark scene needs light sources to feel premium, not murky: gradients, rim light on edges, specular highlights.
- **Contrast:** text needs at least a 4.5:1 contrast ratio against what is actually behind it.

## 7. Camera

- Push-ins build tension. Pull-outs reveal context. Orbits show dimension. Whip pans (with motion blur or smear) make fast transitions.
- **Parallax:** layers moving at different speeds.
- **Rack focus:** blur the far or near layer.
- **Camera shake only on impacts,** decaying within 0.2–0.3 s.

## 8. Transitions

Designed transitions beat stock ones:
- **Match cuts:** a shape becomes the next shape, a line becomes a horizon, a letter's counter becomes a window.
- **Masks and wipes** that follow the motion direction.
- **Zoom-through:** fly into an element into the next scene.
- **Smash cut** to a colour field on a hit.
- **Morphs:** particles or points flowing from one shape to another.

Transitions land on the beat.

## 9. Texture and finish

- Subtle grain (always), a vignette on dark scenes, noise-driven organic motion (things breathe and drift), motion blur on fast moves.
- Echo trails and smears for speed.
- Micro-detail rewards a second look: tiny mono annotations, registration marks, secondary animations.

## 10. Sound

- **Groove:** a kick on the downbeats, and a clap or snare on 2 and 4.
- **Motion sounds:** whooshes on moves, impacts and sub-drops on hits, risers into drops.
- **Before the logo:** a beat of silence, or a filtered breath.
- **The ending:** the final chord rings out under the end frame.
- **Keep it mixed:** sound effects ride on top of the score without masking it.

## 11. Anti-patterns (automatic fails)

- Empty or near-black frames with a few thin lines, and small objects floating in a void.
- Text under 60 px for key messages, clipped text, overlapping text, low-contrast text.
- Everything moving at the same speed or with linear easing. Motion that starts and stops without anticipation or settle.
- Generic "tech HUD" clutter (fake coordinates, tiny meaningless labels) standing in for an idea.
- Slow openings. The first frame is not the most striking frame.
- Two similar scenes back to back, and scenes that don't connect.
- Ending without the brand held clearly and still.
- Invented facts, numbers or claims.

## 12. Styles that reliably impress (with how to build them on a 2D canvas)

- **Kinetic typography:** masked per-letter reveals, scale slams, word swaps on the beat, giant cropped type moving as texture. Build with `S.type`, layers and clips.
- **Bold Swiss/brutalist:** a hard grid, huge grotesk type, flat primary colour blocks that slide in on the beat.
- **Liquid/metaballs:** draw circles into a layer, then composite with `filter = 'blur(24px) contrast(30)'` for gooey blobs. Colour with gradients.
- **3D extruded type or objects:** draw the same shape many times along z with `S.cam().project` or `card()`. Light the front face and darken the sides.
- **Particles:** 1,000–3,000 points driven by noise fields, flowing into shapes (`S.iconPoints`, `S.logoPoints`, `S.morph`), with additive glow.
- **Chrome/liquid metal:** linear gradients with hard stops (dark, bright, dark), moving highlights and rim light.
- **Glass:** a blurred copy of the layer behind (`filter = 'blur(20px)'`) clipped to a rounded rect, with a 1 px bright border and a soft highlight.
- **Line art:** `S.drawOn` for strokes drawing themselves, then fills blooming in.
- **Halftone and dot fields:** a grid of dots sized by an image, a noise field or a gradient.
- **Ribbons and trails:** echo the same path over several past times with decreasing alpha.
- **Collage and cut paper:** rotated rectangles with drop shadows, stamps, torn edges (noise-offset polygons).
- **Data as art:** numbers counting, bars and rings animating to real values.
