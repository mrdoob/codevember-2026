import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA } from '../scene-constants.js';
import { FPS, DURATION, TOTAL_FRAMES, cameraPose } from '../scripts/capture-sequence.js';

test('one full turn in 60 seconds, with a bounded descending camera', () => {
  assert.equal(TOTAL_FRAMES, 1800);
  assert.equal(cameraPose(0).position[1], CAMERA.maxHeight);
  assert.equal(cameraPose(DURATION).position[1], CAMERA.minHeight);
  let previous = cameraPose(0);
  for (let frame = 1; frame <= TOTAL_FRAMES; frame++) {
    const pose = cameraPose(frame / FPS);
    assert.ok(pose.position.every(Number.isFinite));
    assert.ok(pose.position[1] <= previous.position[1]);
    assert.ok(pose.position[1] >= CAMERA.minHeight);
    assert.ok(Math.abs((pose.angle - previous.angle) * 180 / Math.PI - .2) < 1e-12);
    const delta = pose.position.map((v, i) => v - pose.target[i]);
    assert.ok(Math.abs(Math.hypot(...delta) - CAMERA.radius) < 1e-12);
    assert.ok(Math.abs(delta[1] / CAMERA.radius - Math.sin(CAMERA.elevation * Math.PI / 180)) < 1e-12);
    previous = pose;
  }
  assert.ok(Math.abs(previous.angle - Math.PI * 2) < 1e-12);
  assert.deepEqual(cameraPose(-1), cameraPose(0));
  assert.deepEqual(cameraPose(61), cameraPose(60));
});
