import { Matrix4, Vector3 } from 'three/webgpu';
import { inFarmClearing } from '../farm-layout.js';

// Sample the rendered instance positions on a coarse grid. Random patches
// can have the right total count yet still leave large bare areas.
export function checkFieldCoverage(app = window.feather) {
  const cells = new Map(), nearCells = new Map(), matrix = new Matrix4(), point = new Vector3();
  let stalks = 0;
  for (const mesh of app.wheat.batches.filter(mesh => mesh.userData.isWheat)) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      for (const root of mesh.userData.stalkRoots) {
        point.copy(root).applyMatrix4(matrix);
        const key = `${Math.floor(point.x / 2)},${Math.floor(point.z / 2)}`;
        cells.set(key, (cells.get(key) || 0) + 1); stalks++;
        const nearKey = `${Math.floor(point.x)},${Math.floor(point.z)}`;
        nearCells.set(nearKey, (nearCells.get(nearKey) || 0) + 1);
      }
    }
  }
  let checkedCells = 0, minimumEars = Infinity;
  for (let x = -59; x <= 59; x += 2) for (let z = -59; z <= 59; z += 2) {
    const radius = Math.hypot(x, z);
    // Check through the center; only field edges and landmark footprints
    // are excluded. A high total count must not hide a bare camera-side ring.
    if (radius > 58 || inFarmClearing(x, z, false, 2)) continue;
    const count = cells.get(`${Math.floor(x / 2)},${Math.floor(z / 2)}`) || 0;
    minimumEars = Math.min(minimumEars, count); checkedCells++;
    if (count < 12) throw new Error(`Bare field cell at ${x}, ${z}: ${count} ears`);
  }
  if (checkedCells < 1500) throw new Error('Coverage check did not span the field');
  // Check the entire center and camera orbit at finer spacing as well.
  let checkedNearCells = 0, minimumNearEars = Infinity;
  for (let x = -24; x < 24; x++) for (let z = -24; z < 24; z++) {
    const radius = Math.hypot(x + .5, z + .5);
    if (radius > 24) continue;
    const count = nearCells.get(`${x},${z}`) || 0;
    minimumNearEars = Math.min(minimumNearEars, count); checkedNearCells++;
    if (count < 55) throw new Error(`Sparse central field at ${x}, ${z}: ${count} ears`);
  }
  // Away from the farm, comparable annuli must get progressively lighter.
  const rings = [[28, 34], [38, 44], [50, 56]].map(([inner, outer]) => {
    const counts = [];
    for (let x = -59; x <= 59; x += 2) for (let z = -59; z <= 59; z += 2) {
      const radius = Math.hypot(x, z);
      if (radius >= inner && radius < outer && !inFarmClearing(x, z, false, 2)) {
        counts.push(cells.get(`${Math.floor(x / 2)},${Math.floor(z / 2)}`) || 0);
      }
    }
    return { inner, outer, earsPerSquareUnit: counts.reduce((sum, n) => sum + n, 0) / (counts.length * 4) };
  });
  if (!(rings[0].earsPerSquareUnit > rings[1].earsPerSquareUnit * 1.2 && rings[1].earsPerSquareUnit > rings[2].earsPerSquareUnit * 1.2)) {
    throw new Error(`Field density must taper toward the horizon: ${JSON.stringify(rings)}`);
  }
  return { passed: checkedCells + checkedNearCells + 1, stalks, minimumEarsPerFourSquareUnits: minimumEars,
    checkedNearCells, minimumNearEarsPerSquareUnit: minimumNearEars, rings };
}
