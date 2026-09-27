import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { referenceClips } from './replicate';

// The quality bar: reference films (rendered videos the director and critics
// watch) and their source code (which the coder studies). Typically the
// hand-made reels this platform started from.

/** The main script of a self-contained HTML film, with bulky data arrays elided. */
export function extractScript(html: string, name: string): string {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const main = scripts.sort((a, b) => b.length - a.length)[0] ?? '';
  const slim = main
    .replace(/\[(?:\s*-?\d+(?:\.\d+)?\s*,){200,}\s*-?\d+(?:\.\d+)?\s*\]/g, '[/* numeric data omitted */]')
    .replace(/(['"`])data:[^'"`]{500,}\1/g, "'/* data URI omitted */'");
  return `// ─── ${name} ───\n${slim.trim()}`;
}

export async function loadBar(videos: string[], codes: string[]): Promise<{ videos: Buffer[]; code?: string }> {
  const vids: Buffer[] = [];
  for (const v of videos) vids.push((await referenceClips(v, [])).full);
  const code = codes.length ? codes.map(f => extractScript(readFileSync(f, 'utf8'), basename(f))).join('\n\n') : undefined;
  return { videos: vids, code };
}
