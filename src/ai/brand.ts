import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { Browser } from 'playwright';
import { z } from 'zod';
import { hexToHsl, hslHex, mixHex } from '../engine/core/color';
import { DISPLAY_NAMES, SERIF_NAMES } from '../plan/fonts';
import { BrandKitSchema, FactsSchema, type BrandKit } from './brand-kit';
import { image, parseJson, text, user, type LLM, type Part, type Usage } from './llm';
import { brandSystem } from './prompts';
import { toGeminiSchema } from './schema';
import { rasterizeFile, scrapeSite, type RasterLogo, type ScrapeResult } from './scrape';
import { singlePathD, vectorizeLogo } from './vectorize';

// URL → brand kit. The scrape gathers evidence, Gemini reads it (including the
// homepage screenshot and every logo candidate) and fills the kit, and code
// enforces what the engine needs: valid colours with enough contrast, fonts
// from the registry, a vector mark.

const LOGO_KINDS = ['icon', 'combination', 'wordmark', 'none'] as const;

export function brandReplySchema() {
  const facts = toGeminiSchema(z.toJSONSchema(FactsSchema, { io: 'input' }));
  const hex = (d: string) => ({ type: 'string', description: `${d} (#RRGGBB)` });
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      suffix: { type: 'string' },
      tagline: { type: 'string', description: 'at most 60 characters' },
      site: { type: 'string' },
      email: { type: 'string' },
      colors: {
        type: 'object',
        properties: { bg: hex('dark video background'), text: hex('text on bg'), primary: hex('hero brand colour'), secondary: hex('optional'), accent: hex('optional'), light: hex('optional paper colour'), dark: hex('optional ink colour') },
        required: ['bg', 'text', 'primary'],
      },
      fonts: {
        type: 'object',
        properties: { display: { type: 'string', enum: [...DISPLAY_NAMES] }, serif: { type: 'string', enum: [...SERIF_NAMES] } },
        required: ['display'],
      },
      facts,
      logo: {
        type: 'object',
        description: 'Which candidate image is the brand mark',
        properties: {
          candidate: { type: 'integer', description: 'candidate number, or -1 if none of them is the brand mark' },
          kind: { type: 'string', enum: [...LOGO_KINDS], description: 'icon = symbol only; combination = symbol + name; wordmark = name only' },
          markColor: { type: 'string', description: 'If the symbol sits on a tile, badge or background inside the image: the single colour of the symbol itself (#RRGGBB), e.g. "#FFFFFF" for a white symbol on an orange tile. Empty if the symbol is on a transparent background or uses several colours.' },
        },
        required: ['candidate', 'kind'],
      },
    },
    required: ['name', 'tagline', 'colors', 'fonts', 'facts', 'logo'],
  };
}

interface BrandReply {
  name?: string;
  suffix?: string;
  tagline?: string;
  site?: string;
  email?: string;
  colors?: Record<string, string | undefined>;
  fonts?: { display?: string; serif?: string };
  facts?: unknown;
  logo?: { candidate?: number; kind?: (typeof LOGO_KINDS)[number]; markColor?: string };
}

// ── colour rules ────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
export function normHex(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (HEX.test(s)) return s.toUpperCase();
  const short = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase() : undefined;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * Make the palette safe for the engine: a dark background, readable text and
 * a primary that stands off the background. A light site keeps its paper
 * colour as `light` and gets a deep, brand-tinted background.
 */
export function fixColors(input: Record<string, string | undefined>, pageBg?: string): Record<string, string> {
  const c: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const h = normHex(v);
    if (h) c[k] = h;
  }
  c.primary ??= '#3D5AFE';
  let bg = c.bg ?? normHex(pageBg) ?? '#0B0C10';
  if (luminance(bg) > 0.06) {
    if (luminance(bg) > 0.5 && !c.light) c.light = bg;
    const [h, s] = hexToHsl(c.primary);
    bg = hslHex(h, Math.min(s, 35), 5.5);
  }
  c.bg = bg;
  if (!c.text || contrast(c.text, bg) < 7) c.text = '#F2F1EE';
  for (let i = 0; i < 8 && contrast(c.primary, bg) < 2.6; i++) c.primary = mixHex(c.primary, '#FFFFFF', 0.18);
  for (const k of ['secondary', 'accent'] as const) if (c[k] && contrast(c[k], bg) < 1.8) delete c[k];
  if (c.dark && c.light && contrast(c.dark, c.light) < 4.5) delete c.dark;
  return c;
}

const cut = (s: unknown, n: number) => {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  if (t.length <= n) return t;
  const w = t.slice(0, n + 1).replace(/\s+\S*$/, '');
  return (w.length > n * 0.6 ? w : t.slice(0, n)).replace(/[\s,;:–—-]+$/, '');
};

export function finalizeKit(r: BrandReply, site: { host?: string; emails?: string[]; page?: string; source: string }): BrandKit {
  const display = DISPLAY_NAMES.includes(r.fonts?.display as never) ? r.fonts!.display : 'Plus Jakarta Sans';
  const serif = SERIF_NAMES.includes(r.fonts?.serif as never) ? r.fonts!.serif : undefined;
  const email = cut(r.email, 80) || site.emails?.[0] || '';
  const facts = FactsSchema.safeParse(r.facts ?? {});
  return BrandKitSchema.parse({
    brand: {
      name: cut(r.name, 40) || cut(site.host?.split('.')[0], 40) || 'Brand',
      suffix: cut(r.suffix, 40),
      tagline: cut(r.tagline, 90),
      site: cut(r.site, 60).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '') || site.host || '',
      email: /@/.test(email) ? email : '',
      colors: fixColors(r.colors ?? {}, site.page),
      fonts: { display, ...(serif ? { serif } : {}) },
    },
    facts: facts.success ? facts.data : {},
    source: site.source,
  });
}

// ── logo ────────────────────────────────────────────────────────────────────

export function logoFromRaster(r: RasterLogo, kind: (typeof LOGO_KINDS)[number], markColor?: string): { d: string } | undefined {
  if (kind === 'none' || kind === 'wordmark') return undefined;
  if (kind === 'icon' && r.svgText && !markColor) {
    const d = singlePathD(r.svgText);
    if (d) return { d };
  }
  const v = vectorizeLogo(r.rgba, { iconOnly: kind === 'combination', markColor: normHex(markColor) });
  if (!v || v.box[2] < 8 || v.box[3] < 8) return undefined;
  return { d: v.d };
}

export async function logoFromFile(file: string, browser?: Browser): Promise<{ d: string } | undefined> {
  const bytes = readFileSync(file);
  const ext = extname(file).toLowerCase();
  if (ext === '.svg') {
    const d = singlePathD(bytes.toString('utf8'));
    if (d) return { d };
  }
  const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  const r = await rasterizeFile(bytes, mime, browser);
  return r ? logoFromRaster({ ...r, svgText: undefined }, 'icon') : undefined;
}

// ── extraction ──────────────────────────────────────────────────────────────

export interface BrandOptions {
  browser?: Browser;
  /** Use this logo file instead of the site's. */
  logoFile?: string;
  log?: (s: string) => void;
}

export interface BrandResult {
  kit: BrandKit;
  scrape: ScrapeResult;
  logo: { source: string; kind: string } | null;
  usage: Usage[];
  /** The model's raw reply. */
  raw: string;
}

export function brandPrompt(s: ScrapeResult): Part[] {
  const { candidates, ...site } = s.site;
  const parts: Part[] = [
    text(`WEBSITE DATA (scraped)\n${JSON.stringify({ ...site, candidates: candidates.map(({ svg, ...c }) => ({ ...c, svg: svg ? `${svg.length} chars` : undefined })) }, null, 1)}`),
    text('HOMEPAGE SCREENSHOT (1440×900)'),
    image(s.screenshot, 'image/jpeg'),
  ];
  s.logos.forEach((l, i) => {
    parts.push(text(`LOGO CANDIDATE ${i} — ${l.candidate.kind}${l.candidate.alt ? `, "${l.candidate.alt}"` : ''}, ${Math.round(l.candidate.w)}×${Math.round(l.candidate.h)} on the page`), image(l.preview));
  });
  if (!s.logos.length) parts.push(text('No logo candidates were found; set logo.candidate to -1.'));
  parts.push(text('Return the brand kit.'));
  return parts;
}

export async function extractBrand(url: string, llm: LLM, o: BrandOptions = {}): Promise<BrandResult> {
  const log = o.log ?? (() => {});
  log(`  reading ${url}…`);
  const scrape = await scrapeSite(url, { browser: o.browser });
  log(`  ${scrape.site.headings.h1[0] ?? scrape.site.title} · ${scrape.logos.length} logo candidate(s)`);
  const reply = await llm.json({ label: 'brand', system: brandSystem({ display: DISPLAY_NAMES, serif: SERIF_NAMES }), turns: [user(...brandPrompt(scrape))], schema: brandReplySchema(), effort: 'low' });
  const r = parseJson<BrandReply>(reply.text);
  const kit = finalizeKit(r, { host: scrape.site.host, emails: scrape.site.emails, page: scrape.site.colors.page, source: scrape.site.finalUrl });
  let logo: BrandResult['logo'] = null;
  if (o.logoFile) {
    const l = await logoFromFile(o.logoFile, o.browser);
    if (l) { kit.brand.logo = l; logo = { source: o.logoFile, kind: 'file' }; }
  } else {
    const idx = r.logo?.candidate ?? -1, kind = r.logo?.kind ?? 'none';
    const raster = idx >= 0 ? scrape.logos[idx] : undefined;
    const l = raster ? logoFromRaster(raster, kind, r.logo?.markColor) : undefined;
    if (l && raster) { kit.brand.logo = l; logo = { source: raster.candidate.src ?? `inline svg #${idx}`, kind }; }
  }
  log(`  ${kit.brand.name}${kit.brand.suffix ? ` ${kit.brand.suffix}` : ''} · ${kit.brand.colors.primary} on ${kit.brand.colors.bg} · ${kit.brand.fonts.display} · ${logo ? `logo (${logo.kind})` : 'monogram'}`);
  return { kit, scrape, logo, usage: [reply.usage], raw: reply.text };
}
