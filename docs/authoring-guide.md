# Authoring guide: writing plans that feel world-class

The engine handles craft (easing, timing, sound). Whether a piece feels designed comes down to the **plan**: pacing, contrast, and what each section says. These rules come from the two reference pieces in `examples/`. They are written to be pasted into a model's system prompt.

## 1. Structure: hook → build → proof → payoff

| act | purpose | typical techniques | length |
|---|---|---|---|
| **Hook** (0–2 s) | a striking first frame, then a statement cut on the 8ths | `blade-open` → `word-cuts` → `glitch-word` / `impact-word` | 4 beats |
| **Build** | show the craft or the product, one idea per section | `wave-word`, `dot-matrix-word`, `swiss-stack`, `flip-word`, `marquee`, `type-drop`, `code-editor`, `exploded-ui`, `particle-morph`, `mitosis-grid`, `portal-dolly`, `albers-colour` | 2–8 beats each |
| **Proof** | reach, work, numbers | `dot-globe`, `montage`, `stat-odometer` | 2–8 beats |
| **Payoff** | the brand, clean and still | `logo-build` → `end-card`, or `signature-card` | 8–12 beats |

The first frame must already be interesting (`blade-open` or a `word-cuts` word). The last 2 beats should be still: let the final chord ring on a clean frame.

## 2. Pacing is the music

- Hook words go on the 8ths: `word-cuts` with N words over N × 0.5 beats.
- List items go one per beat: `particle-morph` items, `dot-globe` arcs (automatic).
- A rapid montage goes one per 16th: `montage` with `every: 0.25` for 6–10 names.
- Alternate density: follow a busy section (montage, marquee) with a calmer one (globe, logo).
- Before the payoff, build tension with `stat-odometer` `tension: true` and `energy: 3`. The music drops out for a beat before the logo lands.

## 3. Contrast and colour

- Alternate backgrounds between neighbouring sections: dark, light, brand. `word-cuts` does this per word, and `swiss-stack` defaults to the brand tone.
- Use the brand colour as the hero for about ⅓ of the frames, not every frame.
- Put exactly one "colour moment" in a piece (`albers-colour` or a brand-tone `swiss-stack`).

## 4. Copy

- Hook: 3–5 words, all caps, ≤ 10 characters each. Build the brand's own claim out of them, e.g. "IDEAS / DESERVE / MOTION".
- Big words: `glitch-word` ≤ 10 characters, `dot-matrix-word` 1–3 characters plus a suffix, `flip-word` ≤ 12 characters.
- Use the brand's real headline, services, projects and numbers. Never invent statistics, clients or locations. If the brief doesn't state a fact, leave it out.
- The end card is name, tagline (≤ 60 chars), CTA (≤ 18 chars) and contact.

## 5. Continuity pairs (the engine joins these seamlessly)

| from | to | what happens |
|---|---|---|
| `glitch-word` | anything, with `"transition": "blade"` | the word is sliced diagonally and slides apart |
| `flip-word` | any dark section | the camera flies through a letter's counter |
| `code-editor` | `exploded-ui` | code becomes the product |
| `exploded-ui` | `particle-morph` | the page dissolves into particles |
| `particle-morph` | `dot-globe` | the particles collapse into the globe's rim |
| `type-drop` (`morphTo` containing "O") | `mitosis-grid` | the O becomes the dividing cell |
| `mitosis-grid` | `portal-dolly` | the vibrating string becomes the horizon |
| `portal-dolly` | `albers-colour` | the crash zoom fills the frame with the brand colour |
| `albers-colour` | `signature-card` | the last dot becomes the name's full stop |
| `stat-odometer` (tension) | `logo-build` | the blade crosses the frame, then the mark assembles |
| `logo-build` | `end-card` | the tile glides into the lockup |

## 6. Shapes, not templates

These are starting shapes. Build each piece around what this brand actually does and says: change the hook, the order, the lengths and the techniques. Two videos for two different brands, or two briefs for the same brand, should not share a section list.

- **Showreel** (20–30 s): a hook, then 3–6 quick type beats on what the brand does. Then one product or UI moment, one proof moment (reach, work or a real number), and the logo and end card. [`examples/jomiez.plan.json`](../examples/jomiez.plan.json) is one version of this shape.
- **Personal reel** (12–20 s): a type-led hook, one shape or camera sequence that shows craft (`type-drop` → `mitosis-grid` → `portal-dolly` → `albers-colour`), and a `signature-card`. [`examples/resume-reel.plan.json`](../examples/resume-reel.plan.json) is one version.
- **Product launch** (14–20 s): a hook, then the product (`code-editor` → `exploded-ui`, or a `wave-word` in a browser frame). Then what it does (`particle-morph`), one real number, the logo and the end card.
- **Manifesto** (10–16 s): one statement spread over 3–4 type techniques (`word-cuts`, `swiss-stack`, `flip-word`, `marquee`, `impact-word`) with a single colour moment, then straight to the logo.

Hooks to vary between:
- `blade-open` → `word-cuts`;
- `impact-word` on its own;
- `glitch-word` as the very first frame;
- `word-cuts` ending on an "anticipate" word into `impact-word`;
- `marquee` → `impact-word`.
