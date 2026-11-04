import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import WGSLNodeFunction from '../node_modules/three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { sampleSculpture, PRIMITIVES, MAX_BLOBS, rotateVector, sculptureDistance } from '../sculpture.js';
import { GPUMelt, GRID, MAX_VERTICES } from '../gpu-melt.js';
import { drawingSize, simulationStep, MAX_SOLVER_STEP, MAX_FRAME_DELTA } from '../runtime.js';

const seed = sampleSculpture();

test('every primitive fits the fixed blob and field budgets', () => {
  for (const shape of PRIMITIVES) {
    const seed = sampleSculpture(shape);
    assert.ok(seed.groups.length > 900 && seed.groups.length <= MAX_BLOBS);
    assert.equal(new Set(seed.groups).size, 1);
    assert.equal(seed.positions.length, seed.groups.length * 3);
    assert.ok(seed.positions.every(Number.isFinite));
    assert.equal(seed.heatCapacity.length, seed.groups.length);
    assert.ok(seed.heatCapacity.every(v => v >= .649 && v <= 1.401));
    for (let i = 0; i < seed.groups.length; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = seed.positions[i * 3 + axis];
        const size = [GRID.x, GRID.y, GRID.z][axis];
        assert.ok(value > GRID.min[axis] + GRID.cell);
        assert.ok(value < GRID.min[axis] + (size - 2) * GRID.cell);
      }
    }
  }
});

test('rotations preserve solid volumes and floor placement, including tilted capsules', t => {
  assert.deepEqual(PRIMITIVES.slice(0, 2), ['Octahedron', 'Cube']);
  const pose = [.31, -.47, .22, .79];
  for (const shape of PRIMITIVES) {
    const seed = sampleSculpture(shape, 123, pose);
    let minimumY = Infinity;
    for (let i = 0; i < seed.groups.length; i++) {
      const p = seed.positions.subarray(i*3, i*3+3);
      minimumY = Math.min(minimumY, p[1]);
      assert.ok(sculptureDistance(seed, ...p) < .001, `${shape}: rotated particle left its volume`);
      assert.ok(Math.abs(p[2]) < 2.12, `${shape}: rotation exceeded the floor`);
    }
    assert.ok(Math.abs(minimumY - seed.spacing*.42) < 1e-6);
  }
  const random = t.mock.method(Math, 'random', () => .125);
  const capsule = sampleSculpture('Capsule');
  random.mock.restore();
  assert.ok(Math.abs(rotateVector(1, 0, 0, capsule.rotation)[1]) > .5, 'Capsule rotation must include tilt');
  assert.notDeepEqual(sampleSculpture('Cube').rotation, sampleSculpture('Cube').rotation);
});

test('all native kernels parse with the pinned three.js and fit default WebGPU binding limits', () => {
  const material = new MeshPhysicalNodeMaterial();
  const melt = new GPUMelt(seed, material);
  const names = new Set();
  for (const source of melt.kernelSources) {
    const fn = new WGSLNodeFunction(source);
    assert.equal(fn.type, 'void');
    assert.ok(fn.inputs.filter(input => input.type === 'pointer').length <= 8, fn.name);
    names.add(fn.name);
  }
  for (const name of ['resetMelt', 'clearBins', 'buildBins', 'stepMelt', 'buildField', 'marchingCubes', 'finishMesh']) assert.ok(names.has(name));
  // vec3 storage elements are padded to 16 bytes by the WebGPU backend.
  const bytes = melt.attributes.reduce((sum, a) => sum + a.count * (a.itemSize === 3 ? 4 : a.itemSize) * 4, 0);
  assert.ok(bytes < 40_000_000, `${bytes} bytes`);
  assert.equal(MAX_VERTICES % 3, 0);
  assert.ok(MAX_VERTICES <= 180000);
  assert.equal(melt.mesh.geometry.indirect, melt.drawAttribute);
  const rest = melt.rest.value;
  for (const shape of PRIMITIVES) {
    melt.setSeed(sampleSculpture(shape));
    assert.equal(melt.rest.value, rest, 'Switching primitives must reuse buffers');
    for (let i=melt.n;i<MAX_BLOBS;i++) assert.equal(rest.array[i*4+3],-1,'Unused slots must be inactive');
  }
  melt.dispose(); material.dispose();
});

test('native resolution is not capped on Retina, ultrawide or 8K displays', () => {
  for (const [width, height] of [[390, 844], [640, 640], [1440, 900], [3840, 2160], [7680, 4320], [8000, 1000]]) {
    for (const quality of [.5, 1]) for (const ratio of [1, 2]) {
      const size = drawingSize(width, height, quality, ratio);
      assert.equal(size.width, Math.round(width * quality * ratio));
      assert.equal(size.height, Math.round(height * quality * ratio));
    }
  }
  assert.throws(() => drawingSize(NaN, 100));
  assert.throws(() => drawingSize(100, 0));
  assert.throws(() => drawingSize(100, 100, -1));
});

test('simulation time follows elapsed time at different rendering rates', () => {
  for (const fps of [15, 30, 60, 90, 144]) {
    let time = 0, remainder = 0;
    for (let frame = 0; frame < fps; frame++) {
      const step = simulationStep(1 / fps, remainder);
      remainder = step.remainder;
      assert.equal(step.dt, step.steps ? MAX_SOLVER_STEP : 0);
      assert.ok(Number.isInteger(step.steps));
      time += step.dt * step.steps;
    }
    assert.ok(Math.abs(time - 1) < 1e-12, `Melting speed changed at ${fps} fps`);
  }
  assert.equal(simulationStep(20).elapsed, MAX_FRAME_DELTA, 'A stall must not produce unbounded catch-up');
  assert.equal(simulationStep(0).steps, 0);
  assert.equal(simulationStep(NaN).steps, 0);
  let remainder = 0;
  for (let frame = 0; frame < 120; frame++) {
    const step = simulationStep(MAX_SOLVER_STEP + (frame % 2 ? .000001 : -.000001), remainder);
    remainder = step.remainder;
    if (step.steps) assert.equal(step.dt, MAX_SOLVER_STEP, 'Timing jitter must not change the solver timestep');
  }
});
