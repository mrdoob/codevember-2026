import { MembraneSimulation } from "../simulation.js";

export const FINE_GRAIN_COUNT = 14000;
// This seeded distribution has the same 2.3710513 g total mass as 1,400 coarse grains.
export const FINE_RADIUS_SCALE = 0.46316196503735396;
export const SAND_MASS = 0.0023710512983826145;
export const GRAIN_COUNTS = [14000, 28000, 56000];
export function createFineSandSimulation(grainCount = FINE_GRAIN_COUNT) {
  if (!GRAIN_COUNTS.includes(grainCount))
    throw new RangeError("Unknown sand density.");
  // Preserve the seeded 14k checkpoint. Larger populations start with suitably
  // smaller grains before rejection sampling, so scatter remains fast and sparse.
  const radiusScale =
    grainCount === FINE_GRAIN_COUNT
      ? 1
      : FINE_RADIUS_SCALE * Math.cbrt(FINE_GRAIN_COUNT / grainCount) * 1.01;
  const sim = new MembraneSimulation({ grainCount, radiusScale });
  const scale =
    grainCount === FINE_GRAIN_COUNT
      ? FINE_RADIUS_SCALE
      : Math.cbrt(SAND_MASS / sim.masses.reduce((a, b) => a + b, 0));
  for (let i = 0; i < sim.grainCount; i++) {
    const oldRadius = sim.radii[i];
    sim.radii[i] *= scale;
    sim.sizes[i] *= scale;
    sim.masses[i] *= scale ** 3;
    sim.p[i * 3 + 1] += sim.radii[i] - oldRadius;
  }
  sim.syncRenderState();
  return sim;
}
