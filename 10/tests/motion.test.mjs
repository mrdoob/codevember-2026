import test from "node:test";
import assert from "node:assert/strict";
import {
  orbHeight,
  surfaceContactBetween,
  FIRST_CONTACT,
  FLOAT_PERIOD,
  REST_HEIGHT,
  FLOAT_RANGE,
  WATER_HEIGHT,
  ORB_RADIUS,
} from "../motion.js";

test("the lens clears the plinth and reaches the water in a closed cycle", () => {
  for (let i = 0; i <= 400; i++) {
    const t = i * 0.05,
      h = orbHeight(t);
    assert.ok(h - ORB_RADIUS > 0.55);
    assert.ok(
      h >= REST_HEIGHT - 1e-12 && h <= REST_HEIGHT + FLOAT_RANGE + 1e-12,
    );
    assert.ok(Math.abs(h - orbHeight(t + FLOAT_PERIOD)) < 1e-12);
  }
  assert.ok(orbHeight(FLOAT_PERIOD / 2) + ORB_RADIUS > WATER_HEIGHT);
});
test("one contact per ascent at the water height", () => {
  assert.ok(
    Math.abs(orbHeight(FIRST_CONTACT) + ORB_RADIUS - WATER_HEIGHT) < 1e-12,
  );
  assert.equal(surfaceContactBetween(0, FIRST_CONTACT - 0.0001), null);
  assert.equal(
    surfaceContactBetween(FIRST_CONTACT - 0.0001, FIRST_CONTACT + 0.0001),
    FIRST_CONTACT,
  );
  assert.equal(surfaceContactBetween(FIRST_CONTACT, FLOAT_PERIOD), null);
});
test("contact detection is independent of frame rate", () => {
  for (const hz of [24, 30, 60, 144]) {
    const events = [];
    let previous = 0;
    for (let i = 1; i <= hz * 60; i++) {
      const next = i / hz,
        contact = surfaceContactBetween(previous, next);
      if (contact !== null) events.push(contact);
      previous = next;
    }
    assert.deepEqual(events, [
      FIRST_CONTACT,
      FIRST_CONTACT + 20,
      FIRST_CONTACT + 40,
    ]);
  }
});
test("paused and skipped intervals do not replay old ripples", () => {
  assert.equal(surfaceContactBetween(12, 12), null);
  assert.equal(surfaceContactBetween(0, 71), FIRST_CONTACT + 60);
  assert.equal(surfaceContactBetween(71, 72), null);
});
