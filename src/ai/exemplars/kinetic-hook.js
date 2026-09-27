// EXEMPLAR (craft reference, not a template): a 4-beat kinetic type hook.
// Shows: layered depth, impact → hold → release, masked staggered type,
// a full-bleed colour punch on the beat, a camera push, secondary motion,
// light, and beat-synced accents. Brand-neutral copy.
const B = S.beat, C = S.colors;
const push = 1 + 0.06 * S.ease.inOutCubic(S.prog(t, 0, S.dur));          // slow camera push over the whole scene
const hit = S.pulse(t, S.b(2), 10);                                        // decaying accent on beat 3
// 1 · background: deep field + moving light, so the dark never feels empty
g.fillStyle = C.bg; g.fillRect(0, 0, S.W, S.H);
const lx = S.lerp(300, 1600, S.noise(t * 0.3, 1)), ly = S.lerp(200, 880, S.noise(t * 0.3, 7));
S.glow(g, lx, ly, 1100, C.primary, 0.22 + 0.25 * hit);
// 2 · midground: giant cropped outline word drifting as texture (parallax: slower than the foreground)
g.save();
g.translate(S.W / 2, S.H / 2); g.scale(push * 1.02, push * 1.02); g.translate(-S.W / 2, -S.H / 2);
S.font(g, 520, 800); g.strokeStyle = S.rgba(C.text, 0.07); g.lineWidth = 2;
g.strokeText('MOTION', -200 - t * 60, 700);
g.restore();
// 3 · foreground type: beat 1 enters, beat 2 swaps, beat 3 slams
g.save();
g.translate(S.W / 2, S.H / 2); g.scale(push, push); g.translate(-S.W / 2, -S.H / 2);
if (t < S.b(2)) {
  // IDEAS rises in, holds, and leaves upward just before beat 2; WORTH takes its place on beat 2
  if (t < S.b(1)) S.type(g, 'IDEAS', S.W / 2, 600, { t, size: 260, align: 'center', color: C.text, stagger: 0.04, from: { y: 1.1, blur: 10 },
    exit: { at: S.b(0.7), dur: 0.14, stagger: 0.015, to: { y: -1.1 } } });
  else S.type(g, 'WORTH', S.W / 2, 600, { t: t - S.b(1), size: 260, align: 'center', color: C.primary, order: 'center', stagger: 0.03, dur: 0.35, from: { y: 0, scale: 1.4, alpha: 0, blur: 16 } });
} else {
  // full-bleed colour punch lands exactly on the beat, then the word slams in with overshoot
  const wipe = S.ease.outExpo(S.prog(t, S.b(2), S.b(2.25)));
  g.fillStyle = C.primary; g.fillRect(0, S.H * (1 - wipe), S.W, S.H * wipe);
  const s = 0.6 + 0.4 * S.spring(t - S.b(2), 260, 16);
  g.translate(S.W / 2, 560); g.scale(s, s);
  S.font(g, S.fit(g, 'MOVING', 1500, 800), 800); g.textAlign = 'center'; g.fillStyle = C.bg;
  g.fillText('MOVING', 0, 150);
}
g.restore();
// 4 · secondary detail arrives late (follow-through) and small (scale contrast)
const lab = S.prog(t, S.b(0.5), S.b(1));
g.globalAlpha = lab; S.font(g, 18, 500, 'mono'); g.fillStyle = S.rgba(C.text, 0.7); g.textAlign = 'left';
g.fillText('NORTHWIND — 01 / HOOK', S.safe, S.H - S.safe);
g.globalAlpha = 1;
// SFX (in the scene's sfx body): A.impact(t0 + S.b(2), 0.7); A.whoosh(t0 + S.b(1.75), 0.25, 0.25); A.blip(t0, 84, 0.05);
