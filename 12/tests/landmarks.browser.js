import { Box3, Matrix4, Raycaster, Vector3 } from 'three/webgpu';
import { CAMERA } from '../scene-constants.js';
import { terrainHeight } from '../field-terrain.js';

// Raycast the rendered soil, rather than reusing the placement height function.
// Contact points come from the actual model geometry before material batching.
export function checkLandmarks(app = window.feather) {
  const results = [], ray = new Raycaster(), down = new Vector3(0, -1, 0);
  const check = (condition, label, detail) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(detail)}`);
    results.push({ check: label, detail });
  };
  app.scene.updateMatrixWorld(true);
  const soil = app.wheat.terrain.mesh;
  const terrainAt = point => {
    ray.set(new Vector3(point.x, 40, point.z), down);
    return ray.intersectObject(soil)[0]?.point.y;
  };
  check(app.farm.landmarks.length === 13, 'All 13 landmarks have grounding metadata');
  let contactCount = 0, maximumGap = -Infinity;
  for (const landmark of app.farm.landmarks) {
    check(!landmark.bounds.isEmpty() && landmark.contacts.length > 0, `${landmark.name} has geometry and ground contacts`);
    for (const { point, kind } of landmark.contacts) {
      const height = terrainAt(point), gap = point.y - height;
      maximumGap = Math.max(maximumGap, gap); contactCount++;
      check(Number.isFinite(gap) && gap <= .03 && (kind !== 'resting' || gap >= -.1),
        `${landmark.name}: ${kind} contact reaches the visible soil`, { gap });
    }
  }
  const tractor = app.farm.landmarks.find(item => item.name === 'Red tractor');
  const tractorHeight = tractor.bounds.getSize(new Vector3()).y;
  let cropMin = Infinity, cropMax = 0, grassMax = 0, highestRoot = -Infinity;
  const matrix = new Matrix4(), box = new Box3();
  for (const mesh of app.wheat.batches) {
    mesh.geometry.computeBoundingBox();
    const stalks = mesh.userData.stalksPerInstance || 0;
    const positions = mesh.geometry.attributes.position;
    // Recover the base of each stalk from its first tube ring. This checks
    // the baked patch geometry as well as its per-instance scale and tilt.
    const roots = Array.from({ length: stalks }, (_, i) => {
      const sides = mesh.geometry.userData.stemSides, root = new Vector3();
      for (let j = 0; j < sides; j++) root.add(new Vector3().fromBufferAttribute(positions, i * positions.count / stalks + j));
      return root.divideScalar(sides);
    });
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); matrix.premultiply(mesh.matrixWorld);
      box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
      const height = box.max.y - matrix.elements[13];
      if (mesh.userData.isWheat) { cropMin = Math.min(cropMin, height); cropMax = Math.max(cropMax, height); }
      else grassMax = Math.max(grassMax, height);
      for (const root of roots) {
        const point = root.clone().applyMatrix4(matrix);
        highestRoot = Math.max(highestRoot, point.y - terrainHeight(point.x, point.z));
      }
    }
  }
  check(cropMin > .5 && cropMax < tractorHeight * .55, 'Even the tallest crop stays well below the tractor', { cropMin, cropMax, tractorHeight });
  check(grassMax < 1, 'Ground cover stays below one scene unit', { grassMax });
  check(highestRoot <= .01, 'Every modeled stalk reaches the soil, including tilted patch edges', { highestRoot });
  for (let angle = 0; angle < 360; angle += 15) {
    const radius = CAMERA.maxDistance * Math.cos(CAMERA.elevation * Math.PI / 180);
    const point = new Vector3(Math.sin(angle * Math.PI / 180) * radius, CAMERA.minHeight,
      Math.cos(angle * Math.PI / 180) * radius);
    const gap = point.y - terrainAt(point);
    check(Number.isFinite(gap) && gap > 2, 'Soil clears the lowest camera around the widest orbit', { angle, gap });
  }
  for (const root of [soil, app.farm.root]) root.traverse(object => {
    if (!object.isMesh) return;
    for (const attribute of Object.values(object.geometry.attributes)) {
      check(attribute.array.every(Number.isFinite), 'Finite terrain and landmark geometry');
    }
  });
  return { passed: results.length, contactCount, maximumGap, cropHeight: [cropMin, cropMax], tractorHeight, results };
}
