import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launch } from '../cli/browser';

// Reads a website the way a designer would: the homepage screenshot, the
// colours by how much of the page they cover, the heading and body fonts, the
// copy, contact details, and every plausible logo (header SVG/IMG, mask-icon,
// apple-touch-icon, favicon), each rasterised so it can be shown to a vision
// model and traced into a vector mark.

export interface LogoCandidate {
  id: number;
  kind: 'inline-svg' | 'img' | 'mask-icon' | 'apple-touch-icon' | 'icon';
  src?: string;
  svg?: string;
  alt: string;
  w: number;
  h: number;
  score: number;
}

export interface RasterLogo {
  candidate: LogoCandidate;
  /** RGBA pixels for tracing (longest side ≈ 512). */
  rgba: { w: number; h: number; data: Uint8Array };
  /** Small PNG preview on a checkerboard, for the vision model. */
  preview: Buffer;
  /** Raw SVG text when the source was SVG (a single-path SVG is used verbatim). */
  svgText?: string;
}

export interface SiteScrape {
  url: string;
  finalUrl: string;
  host: string;
  title: string;
  description: string;
  siteName: string;
  themeColor: string;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  nav: string[];
  buttons: string[];
  emails: string[];
  text: string;
  colors: {
    page: string;
    backgrounds: { color: string; share: number }[];
    text: { color: string; share: number }[];
    buttons: { color: string; count: number }[];
    cssVars: { name: string; value: string }[];
  };
  fonts: { h1: string; h2: string; body: string; button: string; h1Weight: string };
  candidates: LogoCandidate[];
}

export interface ScrapeResult {
  site: SiteScrape;
  screenshot: Buffer;
  logos: RasterLogo[];
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export function normalizeUrl(u: string): string {
  if (/^(https?|file):/i.test(u)) return u;
  return `https://${u.replace(/^\/+/, '')}`;
}

export async function scrapeSite(url: string, opts: { browser?: Browser; maxLogos?: number } = {}): Promise<ScrapeResult> {
  const browser = opts.browser ?? (await launch());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: UA, locale: 'en-US' });
  try {
    const page = await ctx.newPage();
    const target = normalizeUrl(url);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
    await page.waitForTimeout(1200); // let hero animations settle
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 82 });
    const site = await page.evaluate(collect, target);
    const logos: RasterLogo[] = [];
    for (const c of site.candidates.slice(0, opts.maxLogos ?? 6)) {
      const r = await rasterize(ctx, page, c).catch(() => null);
      if (r) logos.push(r);
    }
    return { site, screenshot, logos };
  } finally {
    await ctx.close();
    if (!opts.browser) await browser.close();
  }
}

/** Rasterise a logo file (SVG or bitmap) given by path or URL, without a site. */
export async function rasterizeFile(bytes: Buffer, mime: string, browser?: Browser): Promise<RasterLogo | null> {
  const b = browser ?? (await launch());
  const ctx = await b.newContext();
  try {
    const page = await ctx.newPage();
    await page.setContent('<!doctype html><body></body>');
    const svgText = /svg/.test(mime) ? bytes.toString('utf8') : undefined;
    const src = `data:${mime};base64,${bytes.toString('base64')}`;
    const cand: LogoCandidate = { id: 0, kind: svgText ? 'inline-svg' : 'img', alt: 'file', w: 0, h: 0, score: 1 };
    return await drawToPixels(page, src, cand, svgText);
  } finally {
    await ctx.close();
    if (!browser) await b.close();
  }
}

async function rasterize(ctx: BrowserContext, page: Page, c: LogoCandidate): Promise<RasterLogo | null> {
  let src: string, svgText: string | undefined;
  if (c.svg) {
    svgText = c.svg;
    src = `data:image/svg+xml;base64,${Buffer.from(c.svg).toString('base64')}`;
  } else if (c.src?.startsWith('data:')) {
    src = c.src;
    if (/^data:image\/svg/.test(src)) svgText = /;base64,/.test(src) ? Buffer.from(src.split(',')[1], 'base64').toString('utf8') : decodeURIComponent(src.split(',')[1]);
  } else if (c.src?.startsWith('file:')) {
    const body = readFileSync(fileURLToPath(c.src));
    const svg = /\.svg$/i.test(c.src);
    if (svg) svgText = body.toString('utf8');
    src = `data:${svg ? 'image/svg+xml' : 'image/png'};base64,${body.toString('base64')}`;
  } else if (c.src) {
    const res = await ctx.request.get(c.src, { timeout: 15_000 });
    if (!res.ok()) return null;
    const body = await res.body();
    const type = (res.headers()['content-type'] ?? '').split(';')[0] || (/\.svg(\?|$)/i.test(c.src) ? 'image/svg+xml' : 'image/png');
    if (/svg/.test(type)) svgText = body.toString('utf8');
    src = `data:${type};base64,${body.toString('base64')}`;
  } else return null;
  return drawToPixels(page, src, c, svgText);
}

async function drawToPixels(page: Page, src: string, c: LogoCandidate, svgText?: string): Promise<RasterLogo | null> {
  const out = await page.evaluate(
    async ([src, hintW, hintH]) => {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
      } catch {
        return null;
      }
      const isSvg = /^data:image\/svg/.test(src);
      let w = img.naturalWidth || hintW || 512, h = img.naturalHeight || hintH || 512;
      if (!w || !h) return null;
      // tiny bitmaps (16–48 px favicons) trace into blobs; skip them
      if (!isSvg && Math.max(w, h) < 64) return null;
      const s = 512 / Math.max(w, h);
      w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
      const pad = 8;
      const cv = document.createElement('canvas');
      cv.width = w + pad * 2; cv.height = h + pad * 2;
      const g = cv.getContext('2d')!;
      // pad with the image's own corner colour so solid tiles stay solid at the border
      g.drawImage(img, pad, pad, w, h);
      const px = g.getImageData(pad, pad, 1, 1).data;
      if (px[3] > 200) {
        g.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
        g.fillRect(0, 0, cv.width, pad); g.fillRect(0, cv.height - pad, cv.width, pad);
        g.fillRect(0, 0, pad, cv.height); g.fillRect(cv.width - pad, 0, pad, cv.height);
      }
      const data = g.getImageData(0, 0, cv.width, cv.height).data;
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + 0x8000)));
      // preview: 200px tall max, on a checkerboard
      const ps = Math.min(1, 200 / cv.height, 360 / cv.width);
      const pv = document.createElement('canvas');
      pv.width = Math.round(cv.width * ps); pv.height = Math.round(cv.height * ps);
      const pg = pv.getContext('2d')!;
      for (let y = 0; y < pv.height; y += 10) for (let x = 0; x < pv.width; x += 10) { pg.fillStyle = (x + y) % 20 ? '#d9d9d9' : '#ffffff'; pg.fillRect(x, y, 10, 10); }
      pg.drawImage(cv, 0, 0, pv.width, pv.height);
      return { w: cv.width, h: cv.height, data: btoa(bin), preview: pv.toDataURL('image/png') };
    },
    [src, c.w, c.h] as const,
  );
  if (!out) return null;
  return {
    candidate: c,
    rgba: { w: out.w, h: out.h, data: new Uint8Array(Buffer.from(out.data, 'base64')) },
    preview: Buffer.from(out.preview.split(',')[1], 'base64'),
    svgText,
  };
}

// ── In-page collector (serialised into the page; must be self-contained) ─────

function collect(target: string): SiteScrape {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const meta = (sel: string) => clean(document.querySelector<HTMLMetaElement>(sel)?.content);
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const texts = (sel: string, n: number, max = 140) => {
    const seen = new Set<string>();
    const out: string[] = [];
    document.querySelectorAll(sel).forEach(el => {
      const t = clean((el as HTMLElement).innerText ?? el.textContent);
      if (t && t.length <= max && !seen.has(t.toLowerCase()) && visible(el) && out.length < n) { seen.add(t.toLowerCase()); out.push(t); }
    });
    return out;
  };
  const toHex = (c: string): string | null => {
    const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 0.5) return null;
    return '#' + [m[1], m[2], m[3]].map(v => Math.round(parseFloat(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const resolveColor = (v: string): string | null => {
    const probe = document.createElement('span');
    probe.style.color = v;
    if (!probe.style.color) return null;
    document.body.appendChild(probe);
    const out = toHex(getComputedStyle(probe).color);
    probe.remove();
    return out;
  };

  // colours by coverage
  const vw = innerWidth, maxY = innerHeight * 3;
  const bg = new Map<string, number>(), fg = new Map<string, number>(), btn = new Map<string, number>();
  const all = Array.from(document.querySelectorAll('body *')).slice(0, 4000);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const top = Math.max(0, r.top + scrollY), bottom = Math.min(maxY, r.bottom + scrollY);
    const area = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)) * Math.max(0, bottom - top);
    if (!area) continue;
    const cs = getComputedStyle(el);
    const b = toHex(cs.backgroundColor);
    if (b) bg.set(b, (bg.get(b) ?? 0) + area);
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent ?? '').join('').trim().length;
    if (own) {
      const f = toHex(cs.color);
      if (f) fg.set(f, (fg.get(f) ?? 0) + own * parseFloat(cs.fontSize));
    }
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && b && r.width < 500 && r.height < 120) btn.set(b, (btn.get(b) ?? 0) + 1);
  }
  const pageBg = toHex(getComputedStyle(document.body).backgroundColor) ?? toHex(getComputedStyle(document.documentElement).backgroundColor) ?? '#FFFFFF';
  // the page itself covers whatever no element paints
  const painted = [...bg.values()].reduce((a, b) => a + b, 0);
  bg.set(pageBg, (bg.get(pageBg) ?? 0) + Math.max(0, vw * Math.min(maxY, document.documentElement.scrollHeight) - painted));
  const share = (m: Map<string, number>, n: number) => {
    const tot = [...m.values()].reduce((a, b) => a + b, 0) || 1;
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([color, v]) => ({ color, share: Math.round((v / tot) * 1000) / 1000 }));
  };
  const cssVars: { name: string; value: string }[] = [];
  const rootStyle = getComputedStyle(document.documentElement);
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules ?? [])) {
      const sr = rule as CSSStyleRule;
      if (!sr.selectorText || !/(^|,)\s*(:root|html|body)\s*(,|$)/.test(sr.selectorText)) continue;
      for (const name of Array.from(sr.style)) {
        if (!name.startsWith('--') || cssVars.length >= 40 || cssVars.some(v => v.name === name)) continue;
        const raw = rootStyle.getPropertyValue(name).trim() || sr.style.getPropertyValue(name).trim();
        if (!raw || raw.length > 60) continue;
        // plain colours, or shadcn/Tailwind-style bare HSL components ("24 95% 53%")
        const hsl = /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(raw);
        const hex = hsl ? resolveColor(`hsl(${raw})`) : /^\d/.test(raw) ? null : resolveColor(raw);
        if (hex) cssVars.push({ name, value: hex });
      }
    }
  }

  // fonts
  const fontOf = (sel: string) => {
    const el = document.querySelector(sel);
    return el ? clean(getComputedStyle(el).fontFamily) : '';
  };

  // logo candidates
  const cands: Omit<LogoCandidate, 'id'>[] = [];
  const abs = (u: string) => { try { return new URL(u, location.href).href; } catch { return ''; } };
  const origin = location.origin;
  const isHomeLink = (a: Element | null) => {
    const href = a?.getAttribute('href') ?? '';
    return !!a && (href === '/' || href === '#' || href === './' || abs(href).replace(/\/$/, '') === origin || abs(href).replace(/[#?].*$/, '').replace(/\/$/, '') === origin);
  };
  const hint = (el: Element) => /logo|brand|mark/i.test([el.getAttribute('class'), el.id, el.getAttribute('alt'), el.getAttribute('aria-label'), el.parentElement?.getAttribute('class'), el.closest('a')?.getAttribute('aria-label')].join(' '));
  const inlineSvg = (svg: SVGSVGElement): string => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('use').forEach(u => {
      const ref = u.getAttribute('href') ?? u.getAttribute('xlink:href');
      const target = ref?.startsWith('#') ? document.querySelector(ref) : null;
      if (target) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        Array.from(target.childNodes).forEach(n => g.appendChild(n.cloneNode(true)));
        u.replaceWith(g);
      }
    });
    const src = Array.from(svg.querySelectorAll('*'));
    const dst = Array.from(clone.querySelectorAll('*'));
    src.forEach((el, i) => {
      const d = dst[i];
      if (!d || !(el instanceof SVGElement)) return;
      const cs = getComputedStyle(el);
      for (const p of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-rule', 'display', 'visibility']) {
        const v = cs.getPropertyValue(p);
        if (v) d.setAttribute(p, v);
      }
    });
    const r = svg.getBoundingClientRect();
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    clone.setAttribute('width', String(Math.round(r.width)));
    clone.setAttribute('height', String(Math.round(r.height)));
    const col = getComputedStyle(svg).color;
    return new XMLSerializer().serializeToString(clone).replace(/currentColor/g, col);
  };
  document.querySelectorAll('svg, img').forEach(el => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.top + scrollY > 260 || r.width < 16 || r.height < 12 || r.width > 520 || r.height > 220) return;
    const home = isHomeLink(el.closest('a'));
    const named = hint(el);
    const inHeader = !!el.closest('header, nav, [class*="header" i], [class*="nav" i]');
    if (!home && !named && !inHeader) return;
    const score = (home ? 3 : 0) + (named ? 3 : 0) + (inHeader ? 1 : 0) + (r.left < vw / 3 ? 1 : 0) - (el.closest('button') ? 2 : 0);
    if (score < 2) return;
    if (el.tagName.toLowerCase() === 'svg') cands.push({ kind: 'inline-svg', svg: inlineSvg(el as SVGSVGElement), alt: clean(el.getAttribute('aria-label')), w: r.width, h: r.height, score });
    else {
      const img = el as HTMLImageElement;
      const src = img.currentSrc || img.src;
      if (src) cands.push({ kind: 'img', src, alt: clean(img.alt), w: r.width, h: r.height, score });
    }
  });
  const link = (sel: string, kind: LogoCandidate['kind'], score: number) =>
    document.querySelectorAll<HTMLLinkElement>(sel).forEach(l => {
      const size = parseInt((l.getAttribute('sizes') ?? '').split('x')[0], 10) || 0;
      if (l.href && !(kind === 'icon' && size && size < 32)) cands.push({ kind, src: l.href, alt: '', w: size, h: size, score: score + (size >= 128 ? 1 : 0) + (/\.svg(\?|$)/i.test(l.href) ? 1 : 0) });
    });
  link('link[rel="mask-icon"]', 'mask-icon', 3);
  link('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]', 'apple-touch-icon', 2);
  link('link[rel~="icon"]', 'icon', 1);
  const seen = new Set<string>();
  const candidates = cands
    .filter(c => { const k = c.src ?? c.svg ?? ''; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((c, id) => ({ id, ...c }));

  const emails = Array.from(new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]')).map(a => decodeURIComponent(a.href.slice(7).split('?')[0]).trim()).filter(Boolean))).slice(0, 5);
  const bodyText = clean(document.body.innerText).slice(0, 7000);
  const found = bodyText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
  let host = '';
  try { host = new URL(location.href).hostname.replace(/^www\./, ''); } catch { /* file: */ }

  return {
    url: target,
    finalUrl: location.href,
    host,
    title: clean(document.title),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
    themeColor: meta('meta[name="theme-color"]'),
    headings: { h1: texts('h1', 3, 200), h2: texts('h2', 14), h3: texts('h3', 20, 100) },
    nav: texts('header a, nav a', 14, 30),
    buttons: texts('button, a[class*="btn" i], a[class*="button" i], [role="button"]', 10, 30),
    emails: Array.from(new Set([...emails, ...found])).slice(0, 5),
    text: bodyText,
    colors: { page: pageBg, backgrounds: share(bg, 8), text: share(fg, 6), buttons: [...btn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([color, count]) => ({ color, count })), cssVars },
    fonts: { h1: fontOf('h1'), h2: fontOf('h2'), body: fontOf('body'), button: fontOf('button, a[class*="btn" i]'), h1Weight: (() => { const h = document.querySelector('h1'); return h ? getComputedStyle(h).fontWeight : ''; })() },
    candidates,
  };
}
