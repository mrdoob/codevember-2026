import { SPACING } from './rope-config.js';

export const SUBDIVISIONS = 3;
export const LEAD_SAMPLES = 240;
export const LEAD_SPACING = 0.04;
export const TWIST = (Math.PI * 2) / 0.34;
export const PLY_SIDES = 8;
export const PLY_COUNT = 3;
export const yarnSamples = count => LEAD_SAMPLES + (count - 1) * SUBDIVISIONS + 1;
// Caps first, followed by one complete ring of segments across all plies.
export const yarnIndexCount = count => PLY_COUNT * PLY_SIDES * (3 + (yarnSamples(count) - 1) * 6);
export const yarnDistance = sample =>
  sample < LEAD_SAMPLES ? (sample - LEAD_SAMPLES) * LEAD_SPACING : ((sample - LEAD_SAMPLES) * SPACING) / SUBDIVISIONS;

// Resample the last edge as the cut advances, before its particle is recycled.
export const yarnCutFraction = phase => Math.max(0, Math.min(1, phase / SPACING - 1));
export const yarnParticleIndex = (sample, count, cut) => {
  const index = Math.max(0, Math.min(count - 1, (sample - LEAD_SAMPLES) / SUBDIVISIONS));
  return index - Math.max(0, index - (count - 2)) * cut;
};
