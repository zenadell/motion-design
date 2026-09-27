import { z } from 'zod';
import { BrandSchema, PlanSchema } from '../plan/schema';

// A brand kit is what the brand extractor produces and the planner consumes:
// the brand block of a plan (colours, fonts, logo) plus the facts a video may
// state. The planner may only use facts found here or in the brief.

export const FactsSchema = z.object({
  headline: z.string().default('').describe('The hero headline, verbatim'),
  description: z.string().default('').describe('What they do, one or two sentences'),
  services: z.array(z.string()).default([]),
  work: z.array(z.string()).default([]).describe('Names of real products, projects or clients shown on the site'),
  stats: z.array(z.object({ value: z.string(), label: z.string() })).default([]).describe('Numbers stated on the site, verbatim'),
  locations: z.array(z.string()).default([]).describe('HQ first, then places they say they serve'),
  audience: z.string().default(''),
  tone: z.string().default('').describe('A few adjectives for the voice'),
  keywords: z.array(z.string()).default([]),
});

export const BrandKitSchema = z.object({
  brand: BrandSchema,
  facts: FactsSchema.prefault({}),
  source: z.string().default('').describe('Where the kit came from (URL or file)'),
});

export type Facts = z.output<typeof FactsSchema>;
export type BrandKit = z.output<typeof BrandKitSchema>;
export type BrandKitInput = z.input<typeof BrandKitSchema>;

/** Accept a brand kit, a bare brand block, or a whole plan (its brand is used). */
export function loadBrandKit(json: unknown): BrandKit {
  const kit = BrandKitSchema.safeParse(json);
  if (kit.success) return kit.data;
  const brand = BrandSchema.safeParse(json);
  if (brand.success) return BrandKitSchema.parse({ brand: brand.data });
  const plan = PlanSchema.safeParse(json);
  if (plan.success) return BrandKitSchema.parse({ brand: plan.data.brand });
  const first = kit.error.issues[0];
  throw new Error(`not a brand kit: ${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'unrecognised shape'}`);
}

/** Everything the planner is allowed to state, as one lowercase string (for fact checks). */
export function factCorpus(kit: BrandKit, brief: string): string {
  const b = kit.brand;
  return [brief, b.name, b.suffix, b.tagline, b.site, b.email, JSON.stringify(kit.facts)].join('\n').toLowerCase();
}
