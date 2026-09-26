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

- Hook: 3–5 words, all caps, ≤ 10 characters each. Build the brand's own claim out of them, e.g. "WE / BUILD / POWERFUL / SOFTWARE".
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

## 6. Recipes

**Brand showreel, 26 s (52 beats)**: see `examples/jomiez.plan.json`.

```
blade-open 0.5 · word-cuts 1.5 · glitch-word 2 (blade) · wave-word 2 · dot-matrix-word 2 · swiss-stack 2 · flip-word 2
code-editor 4 · exploded-ui 4 · particle-morph 8 · dot-globe 8 · montage 2 · stat-odometer 2 (energy 3) · logo-build 4 · end-card 8
```

**Personal reel, 15 s (30 beats)**: see `examples/resume-reel.plan.json`.

```
word-cuts 1.5 · impact-word 2.5 (slice) · marquee 2 · type-drop 4 · mitosis-grid 6 · portal-dolly 6 · albers-colour 4 · signature-card 4
```

**Product launch, 16 s (32 beats)**

```
blade-open 0.5 · word-cuts 1.5 · glitch-word 2 (blade) · code-editor 4 · exploded-ui 4 · particle-morph 6
stat-odometer 2 (energy 3) · logo-build 4 · end-card 8
```
