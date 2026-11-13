import { Matrix4, Vector3, StorageBufferAttribute } from 'three/webgpu';
import { Fn, instanceIndex, storage, uniform, vec4 } from 'three/tsl';
import { wheatWindOffset } from '../wheat-wind.js';
import { terrainHeight } from '../field-terrain.js';

// Execute the actual vertex wind on the GPU at sampled modeled roots and ear
// tips. Check rooted, bounded bending and a visible response in the near field.
export async function checkWheatWind(app = window.feather) {
  const points = [], matrix = new Matrix4(), point = new Vector3();
  const crops = app.wheat.batches.filter(mesh => mesh.userData.isWheat);
  const versions = crops.map(mesh => mesh.instanceMatrix.version);
  for (const mesh of crops) {
    const positions = mesh.geometry.attributes.position;
    const stride = positions.count / mesh.userData.stalksPerInstance;
    const tip = new Vector3(0, -Infinity, 0);
    for (let i = 0; i < stride; i++) {
      point.fromBufferAttribute(positions, i);
      if (point.y > tip.y) tip.copy(point);
    }
    const samples = new Set();
    for (let i = 0; i < mesh.count; i += Math.max(1, Math.floor(mesh.count / 8))) samples.add(i);
    // Instance order follows planting rows, so evenly spaced indices can miss
    // the entire inner ring. Include the closest stalk in each angular sector.
    const closest = new Map();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      point.copy(mesh.userData.stalkRoots[0]).applyMatrix4(matrix);
      const radius = Math.hypot(point.x, point.z);
      if (radius >= 17.5) continue;
      const sector = Math.floor((Math.atan2(point.x, point.z) + Math.PI) * 8 / Math.PI);
      if (radius < (closest.get(sector)?.radius ?? Infinity)) closest.set(sector, { index: i, radius });
    }
    for (const sample of closest.values()) samples.add(sample.index);
    for (const i of samples) {
      mesh.getMatrixAt(i, matrix);
      for (const p of [mesh.userData.stalkRoots[0], tip]) {
        point.copy(p).applyMatrix4(matrix); points.push(point.x, point.y, point.z, 1);
      }
    }
  }
  const count = points.length / 4;
  const heights = Array.from({ length: count }, (_, i) =>
    Math.max(0, points[i * 4 + 1] - terrainHeight(points[i * 4], points[i * 4 + 2])));
  const inputs = storage(new StorageBufferAttribute(new Float32Array(points), 4), 'vec4', count).toReadOnly();
  const output = new StorageBufferAttribute(count, 4), result = storage(output, 'vec4', count);
  const time = uniform(0), breeze = uniform(2);
  const compute = Fn(() => {
    const p = inputs.element(instanceIndex).xyz;
    result.element(instanceIndex).assign(vec4(wheatWindOffset(p, time, breeze), 0));
  })().compute(count);
  let maxRootMotion = 0, maxX = 0, maxZ = 0, maxChange = 0, first;
  try {
    for (const t of [0, .75, 2.5, 6, 12]) {
      time.value = t; app.renderer.compute(compute);
      const offsets = new Float32Array(await app.renderer.getArrayBufferAsync(output));
      for (let i = 0; i < count; i++) {
        const [x, y, z] = offsets.subarray(i * 4, i * 4 + 3);
        if (![x, y, z].every(Number.isFinite)) throw new Error('Non-finite wind displacement');
        if (i % 2 === 0) maxRootMotion = Math.max(maxRootMotion, Math.hypot(x, y, z));
        else {
          maxX = Math.max(maxX, Math.abs(x)); maxZ = Math.max(maxZ, Math.abs(z));
          if (first) maxChange = Math.max(maxChange, Math.hypot(x - first[i * 4], z - first[i * 4 + 2]));
        }
      }
      first ||= offsets;
    }
    if (maxRootMotion > .00001) throw new Error(`Wind detaches roots: ${maxRootMotion}`);
    if (maxChange < .03) throw new Error('Gusts do not vary the wheat motion');
    // Inspect the closest actual crop at the default breeze, not just the
    // most animated point anywhere in the field. This catches a frozen front.
    const near = Array.from({ length: count }, (_, i) => i).filter(i =>
      i % 2 === 1 && Math.hypot(points[i * 4], points[i * 4 + 2]) < 18);
    const motion = new Float32Array(count), reference = [];
    breeze.value = 1;
    for (let t = 0; t <= 4; t += .5) {
      time.value = t; app.renderer.compute(compute);
      const offsets = new Float32Array(await app.renderer.getArrayBufferAsync(output));
      for (let i = 0; i < count; i++) {
        const [x, y, z] = offsets.subarray(i * 4, i * 4 + 3), height = heights[i];
        if (Math.hypot(x, z) > height * .98 + .0001 || height + y < -.0001) throw new Error('Bending exceeds stalk height');
        if (t === 0) reference[i] = [x, y, z];
        const [rx, ry, rz] = reference[i];
        motion[i] = Math.max(motion[i], Math.hypot(x - rx, y - ry, z - rz));
      }
    }
    const relativeMotion = near.map(i => motion[i] / heights[i]).sort((a, b) => a - b);
    const nearMedianMotion = relativeMotion[Math.floor(relativeMotion.length / 2)];
    if (near.length < 10 || !(nearMedianMotion > .35)) throw new Error(`Near wheat is not responding: ${near.length} samples, ${nearMedianMotion}`);
    breeze.value = 0; app.renderer.compute(compute);
    const calm = new Float32Array(await app.renderer.getArrayBufferAsync(output));
    if (calm.some(value => Math.abs(value) > .000001)) throw new Error('Wheat moves at zero breeze');
    if (crops.some((mesh, i) => mesh.instanceMatrix.version !== versions[i])) throw new Error('Wind rewrites CPU instance transforms');
    return { passed: 6, sampledStalks: count / 2, maxRootMotion, maxX, maxZ, maxChange,
      nearSamples: near.length, nearMedianMotion, nearMedianTravel: near.map(i => motion[i]).sort((a, b) => a - b)[Math.floor(near.length / 2)] };
  } finally { compute.dispose(); }
}
