# Plan format

A plan is one JSON document. `motion validate` checks it and fills every default. The exact JSON Schema is emitted by `motion catalog --json` under `planSchema`, with one schema per technique under `techniques[].params`.

```jsonc
{
  "version": 1,
  "meta":   { "title": "Showreel", "fps": 60, "hud": true, "captions": true, "grain": 0.07 },
  "brand":  { ... },
  "music":  { "bpm": 120, "genre": "afro-house", "progression": ["Fm9", "Dbmaj9", "Eb6/9", "Cm7"] },
  "sections": [ { "technique": "blade-open", "beats": 0.5 }, ... ]
}
```

## Time is measured in beats

Every duration is in **beats**. At 120 BPM a beat is 0.5 s, an 8th note 0.25 s and a 16th 0.125 s. Sections are laid end to end, so the total length is the sum of `beats` × 60 / `bpm`.

Keep every section on the 16th-note grid (multiples of 0.25). Then every cut lands on the music. The validator warns if you don't.

## `meta`

| field | default | notes |
|---|---|---|
| `title` | `"Untitled"` | shown in the HUD footer |
| `fps` | `60` | 24–60 |
| `hud` | `true` | timecode, beat counter, section labels, progress bar |
| `captions` | `true` | the small mono "designer notes" techniques draw (e.g. `RGB SPLIT · SLICE GLITCH`) |
| `grain` | `0.07` | film grain amount, 0–0.2 |

## `brand`

| field | required | notes |
|---|---|---|
| `name` | ✓ | the lockup name |
| `suffix` |  | lighter second word, e.g. `"Innovation"` |
| `tagline`, `site`, `email` |  | used by the end card and HUD |
| `colors.bg`, `colors.text`, `colors.primary` | ✓ | `#RRGGBB` |
| `colors.secondary`, `accent`, `surface`, `muted`, `light`, `dark` |  | derived from the required three if omitted |
| `fonts.display` |  | `Plus Jakarta Sans` (default), `Inter Tight`, `Space Grotesk`, `Manrope`, `Sora`, `Unbounded`, `Bricolage Grotesque`, `DM Sans` |
| `fonts.serif` |  | `Instrument Serif` or `Fraunces`, for italic accents |
| `fonts.mono` |  | `JetBrains Mono` |
| `logo.d` |  | SVG path data of a single-colour mark. Omit it to use a traced monogram of the first letter |
| `logo.viewBox` |  | optional; bounds are measured automatically |
| `tile` |  | `true` puts the mark on a rounded app-icon tile |

## `music`

| field | default | notes |
|---|---|---|
| `bpm` | `120` | 90–140 |
| `genre` | `afro-house` | `afro-house` (log drums, shakers, congas, clave) or `electro` (saw bass, off-beat hats) |
| `progression` | per genre | one chord per bar, looped. Symbols like `Am`, `F`, `Fm9`, `Dbmaj9`, `Eb6/9`, `Cm7`, `Gsus4` |
| `volume` | `1` | 0–1.5 |

## `sections[]`

| field | notes |
|---|---|
| `technique` | an id from [techniques.md](techniques.md) |
| `beats` | length; each technique has an allowed range |
| `params` | technique-specific; see the catalog |
| `energy` | music bed while this section plays: `0` = technique hits only, `1` = light groove, `2` = full groove, `3` = build-up (riser + snare roll, and the kick drops out for the last beat). Defaults per technique |
| `transition` | how this section hands over to the next: `cut` (default), `blade`, `slice`, `flash`, `fade`, `slide`, `zoom`, `wipe`, or `{ "type": "blade", "beats": 0.5 }` |
| `label` | HUD chapter label; consecutive sections with the same label share a chapter number |
| `hud` | force the HUD on or off for this section (outros hide it by default) |

## Validation output

`motion validate plan.json --json` prints:

```json
{ "ok": false, "errors": [ { "path": "sections[3].params.words", "message": "Too small: expected array to have >=1 items" } ], "warnings": [] }
```

Paths point at the exact field, and unknown technique ids come with a "did you mean" suggestion. This is designed to be fed back to a model so it can repair its own plan.
