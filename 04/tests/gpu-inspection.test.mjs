import test from 'node:test';
import assert from 'node:assert/strict';
import { GPURopeSimulation } from '../gpu-rope.js';
import { SPACING } from '../rope-config.js';

test('GPU inspection keeps positions, active count, and time from the same frame', async () => {
  const count = 6;
  const snapshot = live => {
    const positions = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) positions[i * 4 + 1] = 1 - (i < live ? i * SPACING : 0);
    const state = new Float32Array([0, SPACING, 0, 0, live, 0, 0, 0]);
    return { positions, state, normals: new Float32Array(count * 8) };
  };
  const frames = [snapshot(3), snapshot(4)];
  let frame = 0,
    advancing = false;
  const simulation = {
    engine: 'WebGPU compute',
    time: 1,
    count,
    total: count,
    strands: 1,
    a: { value: 'positions' },
    state: { value: 'state' },
    normals: { value: 'normals' },
    renderer: {
      getArrayBufferAsync(name) {
        const data = frames[frame][name].slice().buffer;
        if (!advancing) {
          advancing = true;
          // Animation can advance as soon as an asynchronous read yields.
          queueMicrotask(() => {
            frame = 1;
            simulation.time = 2;
          });
        }
        return Promise.resolve(data);
      }
    }
  };
  const report = await GPURopeSimulation.prototype.inspect.call(simulation);
  assert.equal(simulation.time, 2, 'The live simulation should have advanced during readback');
  assert.equal(report.time, 1);
  assert.equal(report.particles, 3);
  assert.ok(report.maxStretch < 1e-5, 'Inactive slots from a later frame must not look like stretched yarn');
  assert.equal(report.finite, true);
});
