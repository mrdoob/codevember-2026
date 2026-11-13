import { sunDirection } from './landscape.js';

// The farm faces the clearing from the horizon opposite the setting sun.
const angle = Math.atan2(-sunDirection.x, -sunDirection.z);
export const FARM = Object.freeze({ angle, x: Math.sin(angle) * 39, z: Math.cos(angle) * 39 });
export const FARM_SITES = [
  { name: 'Farmstead', kind: 'farm', angle, radius: 39, clearings: [[-5, 1, 5.2, 4.1], [3.5, -6, 3.4, 3.5, true], [10.5, 2, 1, 1]] },
  { name: 'Barn and silo', kind: 'barn', angle: angle + 1.45, radius: 37, clearings: [[-2, 0, 4.2, 3.2], [5.5, 1, 1.8, 1.8], [0, -5, 2.6, 1.5]] },
  { name: 'Shed and hay', kind: 'shed', angle: angle - 1.4, radius: 35, clearings: [[-2, 1, 3.5, 2.8], [6, 2, .9, .9], [-1, -5, 2.6, 1.5]] },
  { name: 'Western trees', kind: 'grove', angle: angle + 2.5, radius: 42, clearings: [[0, 0, 1, 1], [5, 2, .8, .8]], scale: 1.1, seed: 72 },
  { name: 'Eastern tree', kind: 'tree', angle: angle - 2.45, radius: 40, clearings: [[0, 0, 1, 1]], scale: 1.2, seed: 37 },
].map(site => Object.freeze({ ...site, x: Math.sin(site.angle) * site.radius, z: Math.cos(site.angle) * site.radius }));

export function inFarmClearing(x, z, lowCover = false, margin = 0) {
  return FARM_SITES.some(site => {
    const dx = x - site.x, dz = z - site.z;
    const localX = dx * Math.cos(site.angle) - dz * Math.sin(site.angle);
    const localZ = dx * Math.sin(site.angle) + dz * Math.cos(site.angle);
    // Clear only the actual object footprints. Crops continue between the
    // buildings and beneath tree crowns, avoiding large bare oval yards.
    return site.clearings.some(([cx, cz, width, depth, allowLowCover]) =>
      !(lowCover && allowLowCover) && ((localX - cx) / (width + margin)) ** 2 + ((localZ - cz) / (depth + margin)) ** 2 < 1);
  });
}
