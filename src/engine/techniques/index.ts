// The technique registry. Order here is the order of the catalog.
import albersColour from './albers-colour';
import bladeOpen from './blade-open';
import codeEditor from './code-editor';
import dotGlobe from './dot-globe';
import dotMatrixWord from './dot-matrix-word';
import endCard from './end-card';
import explodedUi from './exploded-ui';
import flipWord from './flip-word';
import glitchWord from './glitch-word';
import impactWord from './impact-word';
import logoBuild from './logo-build';
import marquee from './marquee';
import mitosisGrid from './mitosis-grid';
import montage from './montage';
import particleMorph from './particle-morph';
import portalDolly from './portal-dolly';
import signatureCard from './signature-card';
import statOdometer from './stat-odometer';
import swissStack from './swiss-stack';
import typeDrop from './type-drop';
import waveWord from './wave-word';
import wordCuts from './word-cuts';
import type { Technique } from './types';

export const TECHNIQUES: Technique[] = [
  bladeOpen, wordCuts, glitchWord, impactWord,
  waveWord, dotMatrixWord, swissStack, flipWord, marquee, typeDrop,
  codeEditor, explodedUi,
  particleMorph, mitosisGrid, albersColour,
  portalDolly,
  dotGlobe, montage, statOdometer,
  logoBuild, endCard, signatureCard,
] as unknown as Technique[];

const byId = new Map(TECHNIQUES.map(t => [t.id, t]));
export const techniqueIds = (): string[] => TECHNIQUES.map(t => t.id);

// Code-defined scenes ("scene:<id>") of the plan being played, installed by the engine.
let custom = new Map<string, Technique>();
export function setCustomTechniques(list: Technique[]): void {
  custom = new Map(list.map(t => [t.id, t]));
}

export function getTechnique(id: string): Technique | undefined {
  return byId.get(id) ?? custom.get(id);
}
