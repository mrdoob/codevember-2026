import test from 'node:test';
import assert from 'node:assert/strict';
import { RopeSimulation } from '../rope-simulation.js';
import { RADIUS, SPACING, INITIAL_COUNT, GPU_CAPACITY } from '../rope-config.js';

test('startup leaves the floor empty and reserves inactive capacity for feeding', () => {
  const s = new RopeSimulation({ count: GPU_CAPACITY });
  assert.ok(s.positions.every(Number.isFinite));
  assert.equal(s.inspect().particles, INITIAL_COUNT * s.strands);
  assert.equal(s.inspect().capacity, GPU_CAPACITY * s.strands);
  assert.ok(s.inspect().minY > 1);
  assert.equal(s.beginGrab(INITIAL_COUNT + 1, [0, 1, 0]), false);
  for (let i = 0; i < s.total; i++) {
    if (!s.isActive(i)) {
      assert.equal(s.weights[i], 0);
      continue;
    }
    if (i % s.count === 0) continue;
    const j = i * 3,
      p = s.positions;
    const length = Math.hypot(p[j] - p[j - 3], p[j + 1] - p[j - 2], p[j + 2] - p[j - 1]);
    assert.ok(Math.abs(length - SPACING) < 1e-12, `Invalid hanging segment ${i}: ${length}`);
  }
});

test('feeding grows the active yarn to capacity without reallocating', () => {
  const s = new RopeSimulation({ strands: 1, count: INITIAL_COUNT + 12 });
  const positions = s.positions;
  s.settings.feed = 0;
  s.settings.wander = 0;
  for (let i = 0; i < 30; i++) s.advance(1 / 30);
  assert.equal(s.active[0], INITIAL_COUNT);
  assert.ok(s.inspect().minY > 1, 'Inactive capacity must not fall onto the floor');
  s.settings.feed = 1.35;
  for (let i = 0; i < 90; i++) s.advance(1 / 30);
  assert.equal(s.active[0], s.count);
  assert.equal(s.positions, positions);
  assert.ok(s.travel[0] > 12 * SPACING, 'Feeding must continue after capacity is reached');
});

test('fixed-step motion agrees at 30 and 120 fps, including feeding', () => {
  const a = new RopeSimulation({ strands: 2, count: 140 }),
    b = new RopeSimulation({ strands: 2, count: 140 });
  for (let i = 0; i < 90; i++) a.advance(1 / 30);
  for (let i = 0; i < 360; i++) b.advance(1 / 120);
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.travel, b.travel);
  assert.ok(a.travel[0] > 3, 'Yarn must actually feed into the scene');
});

test('a full tangle remains bounded while its entire length is recycled', () => {
  const s = new RopeSimulation();
  s.settings.feed = 3;
  const frames = Math.ceil(((s.count * SPACING + 2) / s.settings.feed) * 30);
  for (let i = 0; i < frames; i++) s.advance(1 / 30);
  const state = s.inspect();
  assert.equal(state.finite, true);
  assert.ok(state.minY >= RADIUS - 1e-9);
  assert.ok(state.maxY <= 5.61);
  assert.ok(state.meanStretch < 0.025, JSON.stringify(state));
  assert.ok(state.maxStretch < 0.3, JSON.stringify(state));
  assert.ok(s.travel[0] > s.count * SPACING);
  assert.equal(s.positions.length, s.total * 3);
});

test('coincident particles on separate ropes separate without NaNs', () => {
  const s = new RopeSimulation({ strands: 2, count: 10 });
  s.positions.set([0, 1, 0], 4 * 3);
  s.positions.set([0, 1, 0], 14 * 3);
  for (let i = 0; i < 8; i++) s.contact();
  const p = s.positions;
  const distance = Math.hypot(p[12] - p[42], p[13] - p[43], p[14] - p[44]);
  assert.ok(distance > RADIUS * 1.9);
  assert.ok(p.every(Number.isFinite));
});

test('a grab follows the material as it feeds, lifts it, and releases', () => {
  const s = new RopeSimulation();
  const index = 30,
    target = [s.positions[index * 3] + 0.3, s.positions[index * 3 + 1] + 0.5, s.positions[index * 3 + 2] + 0.2];
  assert.equal(s.beginGrab(0, target), false);
  assert.equal(s.beginGrab(index, target), true);
  for (let i = 0; i < 90; i++) s.advance(1 / 60);
  assert.ok(s.grab.index > index, 'Grab should track the same material through recycling');
  const p = s.positions.slice(s.grab.index * 3, s.grab.index * 3 + 3);
  assert.ok(Math.hypot(...p.map((v, i) => v - target[i])) < 0.12);
  s.endGrab();
  assert.equal(s.grab, null);
  for (let i = 0; i < 90; i++) s.advance(1 / 60);
  assert.equal(s.inspect().finite, true);
});

test('reset restores the hanging lengths, feed phase, and clock', () => {
  const s = new RopeSimulation({ strands: 2, count: 140 });
  const initial = s.positions.slice();
  for (let i = 0; i < 20; i++) s.advance(1 / 30);
  s.beginGrab(20, [1, 4, 1]);
  s.reset();
  assert.deepEqual(s.positions, initial);
  assert.equal(s.time, 0);
  assert.equal(s.grab, null);
  assert.ok(s.velocity.every(v => v === 0));
  assert.ok(s.travel.every(v => v === 0));
  assert.ok(s.active.every(v => v === INITIAL_COUNT));
});

test('resting yarn resists small sideways forces instead of creeping across the floor', () => {
  const s = new RopeSimulation({ strands: 1, count: 40 });
  for (let a = 0; a < s.total; a++) s.positions.set([a * SPACING, RADIUS, 0], a * 3);
  s.previous.set(s.positions);
  s.velocity.fill(0);
  const initial = s.positions.slice();
  for (let frame = 0; frame < 120; frame++) {
    for (let a = 1; a < s.total; a++) s.velocity[a * 3] = 0.02;
    s.step(false);
  }
  for (let i = 0; i < s.positions.length; i++) assert.ok(Math.abs(s.positions[i] - initial[i]) < 1e-8);
  // Grip is contact friction, not a permanent pin: lifting releases it.
  s.beginGrab(25, [20 * SPACING, 1, 0]);
  for (let frame = 0; frame < 120; frame++) s.step(false);
  assert.ok(s.positions[25 * 3 + 1] > 0.85);
});

test('touching yarn grips tangentially, and the friction control can release it', () => {
  const measure = friction => {
    const s = new RopeSimulation({ strands: 2, count: 8 });
    s.settings.friction = friction;
    for (let a = 0; a < s.total; a++) s.positions.set([a * 10, 10, 0], a * 3);
    const a = 3 * 3,
      b = 11 * 3;
    s.positions.set([0, 1, 0], a);
    s.positions.set([0, 1, 0.11], b);
    s.previous.set(s.positions);
    s.positions[a] = 0.002;
    const nx = -0.002 / Math.hypot(0.002, 0.11),
      nz = 0.11 / Math.hypot(0.002, 0.11);
    s.contact();
    const dx = s.positions[a] - s.previous[a] - s.positions[b] + s.previous[b];
    const dz = s.positions[a + 2] - s.previous[a + 2] - s.positions[b + 2] + s.previous[b + 2];
    return Math.abs(dx * nz - dz * nx);
  };
  assert.ok(measure(0.85) < 1e-8);
  assert.ok(measure(0) > 0.0019);
});
