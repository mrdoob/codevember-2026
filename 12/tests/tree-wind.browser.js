import { StorageBufferAttribute, Vector3 } from 'three/webgpu';
import { Fn, instanceIndex, storage, uniform, vec4 } from 'three/tsl';
import { treeWindOffset } from '../tree-wind.js';

// Evaluate the same TSL used by both tree materials at their actual vertices.
// Catch sliding trunks, clipping and inert crowns.
export async function checkTreeWind(app = window.feather) {
  const trees = app.farm.root.children.flatMap(site => site.children.filter(child => child.userData.treeWind));
  if (trees.length !== 5) throw new Error(`Expected five rooted trees, got ${trees.length}`);
  let maxRootMotion = 0, minCrownTravel = Infinity, maxTravel = 0, checkedVertices = 0;
  for (const tree of trees) for (const mesh of tree.children) {
    const position = mesh.geometry.attributes.position, count = position.count, points = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) points.set([position.getX(i), position.getY(i), position.getZ(i), 1], i * 4);
    const input = storage(new StorageBufferAttribute(points, 4), 'vec4', count).toReadOnly();
    const output = new StorageBufferAttribute(count, 4), result = storage(output, 'vec4', count);
    const time = uniform(0), breeze = uniform(1);
    const origin = uniform(tree.userData.treeWind.origin), direction = uniform(tree.userData.treeWind.direction);
    const leaves = mesh.material.name.endsWith('foliage') ? 1 : 0;
    const compute = Fn(() => {
      result.element(instanceIndex).assign(vec4(treeWindOffset(input.element(instanceIndex).xyz, origin, direction, time, breeze, leaves), 0));
    })().compute(count);
    let first, crownTravel = 0;
    const p = new Vector3(), before = tree.matrixWorld.clone();
    try {
      for (let t = 0; t <= 6; t += .5) {
        time.value = t; app.renderer.compute(compute);
        const offsets = new Float32Array(await app.renderer.getArrayBufferAsync(output));
        for (let i = 0; i < count; i++) {
          const [x, y, z] = offsets.subarray(i * 4, i * 4 + 3);
          if (![x, y, z].every(Number.isFinite)) throw new Error('Non-finite tree wind');
          if (points[i * 4 + 1] <= 0) maxRootMotion = Math.max(maxRootMotion, Math.hypot(x, y, z));
          if (first) {
            const travel = Math.hypot(x - first[i * 4], y - first[i * 4 + 1], z - first[i * 4 + 2]);
            maxTravel = Math.max(maxTravel, travel);
            if (points[i * 4 + 1] > 5) crownTravel = Math.max(crownTravel, travel);
          }
          p.set(points[i * 4] + x, points[i * 4 + 1] + y, points[i * 4 + 2] + z);
          if (!mesh.geometry.boundingBox.containsPoint(p)) throw new Error('Tree wind exceeds its culling bounds');
        }
        first ||= offsets;
      }
      minCrownTravel = Math.min(minCrownTravel, crownTravel);
      if (crownTravel < .25) throw new Error(`Tree crown barely moves: ${crownTravel}`);
      breeze.value = 2; app.renderer.compute(compute);
      const strong = new Float32Array(await app.renderer.getArrayBufferAsync(output));
      for (let i = 0; i < count; i++) {
        p.set(points[i * 4] + strong[i * 4], points[i * 4 + 1] + strong[i * 4 + 1], points[i * 4 + 2] + strong[i * 4 + 2]);
        if (!mesh.geometry.boundingBox.containsPoint(p)) throw new Error('Strong wind exceeds tree bounds');
      }
      breeze.value = 0; app.renderer.compute(compute);
      const calm = new Float32Array(await app.renderer.getArrayBufferAsync(output));
      if (calm.some(value => Math.abs(value) > .000001)) throw new Error('Tree moves at zero breeze');
      if (!before.equals(tree.matrixWorld)) throw new Error('Wind rewrites tree transforms');
      checkedVertices += count;
    } finally { compute.dispose(); }
  }
  if (maxRootMotion > .000001) throw new Error(`Tree roots slide: ${maxRootMotion}`);
  let boundedMeshes = 0;
  for (const reference of app.meshlets._records) {
    for (const entry of reference.deref()?.entries || []) if (entry.material?.name.startsWith('Wind-blown')) {
      if (entry.batch?.unbounded?.value !== 0) throw new Error('Tree animation disabled meshlet culling');
      boundedMeshes++;
    }
  }
  if (boundedMeshes !== 10) throw new Error(`Animated tree batches missing: ${boundedMeshes}/10`);
  return { passed: 7, trees: trees.length, checkedVertices, maxRootMotion, minCrownTravel, maxTravel, boundedMeshes };
}
