import test from "node:test";
import assert from "node:assert/strict";
import { DaylightTransition } from "../lighting-transition.js";

test("daylight fades monotonically and settles without depending on frame rate", () => {
  const halfway = [30, 60, 120].map((rate) => {
    const light = new DaylightTransition();
    light.setTarget(0);
    let previous = 1;
    for (let i = 0; i < rate; i++) {
      light.advance(1 / rate);
      assert.ok(light.value >= 0 && light.value <= previous);
      previous = light.value;
    }
    const intermediate = light.value;
    light.advance(5);
    assert.equal(light.value, 0);
    assert.equal(light.active, false);
    return intermediate;
  });
  assert.ok(Math.max(...halfway) - Math.min(...halfway) < 1e-12);
});

test("reversing daylight preserves position and velocity, then reaches the new target", () => {
  const light = new DaylightTransition();
  light.setTarget(0);
  light.advance(0.6);
  const before = [light.value, light.velocity];
  light.setTarget(1);
  assert.deepEqual([light.value, light.velocity], before);
  for (let i = 0; i < 300; i++) {
    light.advance(1 / 60);
    assert.ok(light.value >= 0 && light.value <= 1);
  }
  assert.equal(light.value, 1);
  assert.equal(light.active, false);
  light.setTarget(0, true);
  assert.equal(light.value, 0);
  assert.equal(light.velocity, 0);
});
