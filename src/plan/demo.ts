import type { PlanInput } from './schema';

/** A neutral demo brand — deliberately not orange, to prove the library re-themes. */
export const DEMO_BRAND: PlanInput['brand'] = {
  name: 'Northwind',
  suffix: 'Studio',
  tagline: 'Design and engineering for ambitious teams.',
  site: 'northwind.studio',
  email: 'hello@northwind.studio',
  colors: { bg: '#0A0C14', text: '#EEF1F8', primary: '#3D5AFE', secondary: '#7C8CFF', accent: '#2EE6A6' },
  fonts: { display: 'Space Grotesk', serif: 'Instrument Serif' },
};
