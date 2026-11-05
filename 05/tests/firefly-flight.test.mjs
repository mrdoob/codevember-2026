import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three/webgpu';
import { createMossFlight } from '../firefly-flight.js';
import { createFireflies, FIREFLY_INTENSITY } from '../fireflies.js';
import { createRockReaction } from '../rock-reaction.js';
import { randomSeed } from '../random.js';
import { groundHeight } from '../woodland.js';

test('insects notice the ascent individually, accelerate behind the moss, and catch up', () => {
  const layout = { center: [0, 2.05, 0], groundY: .5, phase: 0 };
  const random = randomSeed(5052027);
  const flights = Array.from({ length: 6 }, () => createMossFlight(layout, random));
  const positions = flights.map(() => new Vector3(0, .5, 0)), zero = new Vector3();
  const noticed = flights.map(() => null);
  let spread;
  for (let frame = 0; frame <= 900; frame++) {
    const time = frame / 60;
    for (let i = 0; i < flights.length; i++) {
      const before = positions[i].clone();
      flights[i].sample(time, zero, positions[i]);
      assert.ok(positions[i].distanceTo(before) <= 1.35 / 60 + 1e-9, 'Pursuit has a bounded flight speed');
      if (time <= 1.5) assert.equal(positions[i].y, .5, 'Rocks rise before insects interrupt their wandering');
      if (noticed[i] === null && positions[i].y > .52) noticed[i] = time;
    }
    if (frame === 240) spread = Math.max(...positions.map(p => p.y)) - Math.min(...positions.map(p => p.y));
  }
  assert.ok(spread > .25 && Math.max(...noticed) - Math.min(...noticed) > .5, 'Insects react and catch up at different times');
  assert.ok(positions.every(p => Math.abs(p.y - layout.center[1]) < .15), 'They eventually return to the moss');
  const direct = createMossFlight(layout, randomSeed(5052027)), at = new Vector3();
  direct.sample(15, zero, at);
  assert.ok(at.distanceTo(positions[0]) < 1e-12, 'Fixed steps reproduce the same flight when seeking');
  const held = at.clone(); direct.sample(15, zero, at);
  assert.deepEqual(at.toArray(), held.toArray(), 'A paused clock freezes flight');
  direct.sample(0, zero, at);
  assert.deepEqual(at.toArray(), [0, .5, 0], 'Rewinding restores the grounded opening');
});

test('nudges attract fireflies after a delay without carrying them or changing their glow', () => {
  const layout = { center: [0, 2.05, 0], scale: .7, width: .8, phase: 0 };
  const reaction = createRockReaction(.7);
  const flies = createFireflies([layout], (_, out) => out.copy(reaction.offset));
  const control = createFireflies([layout]);
  const point = new Vector3(.3, .2, .6), direction = new Vector3(1, 0, 0), center = new Vector3();
  let largestResponse = 0;
  try {
    for (let frame = 0; frame <= 720; frame++) {
      const time = frame / 60;
      if (frame === 120) reaction.kick(point, direction, center, time);
      reaction.update(time); flies.update(time); control.update(time);
      assert.deepEqual(flies.glows.array, control.glows.array, 'Behavior leaves the visible glow envelope unchanged');
      for (let i = 0; i < flies.lights.length; i++) {
        const light = flies.lights[i], other = control.lights[i];
        const distance = light.position.distanceTo(other.position);
        if (time < 2.4 || i >= 24) assert.ok(distance < 1e-9, 'No instant attachment; ambient insects are unaffected');
        if (i < 24) largestResponse = Math.max(largestResponse, light.position.x - other.position.x);
        if (time === 12) assert.ok(distance < .12, 'Pursuit settles back near the moss');
        assert.ok(light.position.y > groundHeight(light.position.x, light.position.z) + .05);
        assert.ok(Math.abs(light.intensity - flies.glows.getX(i) * FIREFLY_INTENSITY) < 3e-8, 'Only point-light strength is doubled');
        assert.ok(light.position.distanceTo(new Vector3().fromBufferAttribute(flies.positions, i)) < 1e-6, 'Light and lantern share the pursued position');
      }
    }
    assert.ok(largestResponse > .025, 'The insects visibly steer toward the nudged rock');
  } finally { flies.dispose(); control.dispose(); }
});
