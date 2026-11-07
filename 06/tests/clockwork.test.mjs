import test from "node:test";
import assert from "node:assert/strict";
import {
  Clockwork,
  PLANETS,
  PINION_TEETH,
  orbitAngle,
  wrappedDelta,
} from "../motion.js";

test("winding any planet moves that planet by the requested angle", () => {
  for (let i = 0; i < PLANETS.length; i++) {
    const clock = new Clockwork();
    clock.clock = 9;
    const before = orbitAngle(i, clock.clock);
    clock.turn(i, -0.43);
    assert.ok(Math.abs(orbitAngle(i, clock.clock) - before + 0.43) < 1e-12);
    for (let j = 0; j < PLANETS.length; j++) {
      const expected = (-0.43 * PLANETS[i].teeth) / PLANETS[j].teeth;
      assert.ok(
        Math.abs(orbitAngle(j, clock.clock) - orbitAngle(j, 9) - expected) <
          1e-12,
      );
    }
  }
});

test("release momentum is independent of display refresh rate", () => {
  const results = [30, 60, 120].map((rate) => {
    const clock = new Clockwork();
    clock.release(8);
    for (let i = 0; i < rate * 5; i++) clock.advance(1 / rate);
    return clock.clock;
  });
  assert.ok(Math.max(...results) - Math.min(...results) < 1e-10);
});

test("dragging eases all carriers toward the pointer without jumping", () => {
  for (let i = 0; i < PLANETS.length; i++) {
    const clock = new Clockwork();
    clock.paused = true;
    clock.beginTurn();
    clock.turn(i, 0.4);
    assert.equal(
      clock.clock,
      0,
      "pointer input must not teleport the mechanism",
    );
    clock.advance(1 / 60);
    const angle = orbitAngle(i, clock.clock) - PLANETS[i].phase;
    assert.ok(
      angle > 0 && angle < 0.4,
      "the first frame must ease toward the target",
    );
    for (let frame = 0; frame < 360; frame++) clock.advance(1 / 60);
    assert.ok(
      Math.abs(orbitAngle(i, clock.clock) - PLANETS[i].phase - 0.4) < 1e-10,
    );
  }
});

test("drag easing is frame-rate independent and finishes after release while paused", () => {
  const results = [30, 60, 120].map((rate) => {
    const clock = new Clockwork();
    clock.paused = true;
    clock.beginTurn();
    clock.turn(4, 0.6);
    for (let frame = 0; frame < rate / 10; frame++) clock.advance(1 / rate);
    const first = clock.clock;
    clock.endTurn();
    for (let frame = 0; frame < rate * 3; frame++) clock.advance(1 / rate);
    assert.ok(
      Math.abs(clock.clock - (0.6 * PLANETS[4].teeth) / PINION_TEETH) < 1e-10,
    );
    assert.equal(clock.targetClock, null);
    const stopped = clock.clock;
    clock.advance(2);
    assert.equal(clock.clock, stopped);
    return first;
  });
  assert.ok(Math.max(...results) - Math.min(...results) < 1e-10);
});

test("reversing a drag settles at its new target and cancellation discards pending motion", () => {
  const clock = new Clockwork();
  clock.paused = true;
  clock.beginTurn();
  clock.turn(2, 0.5);
  clock.advance(0.06);
  clock.turn(2, -0.8);
  clock.endTurn();
  for (let i = 0; i < 240; i++) clock.advance(1 / 60);
  assert.ok(
    Math.abs(orbitAngle(2, clock.clock) - PLANETS[2].phase + 0.3) < 1e-10,
  );
  clock.beginTurn();
  clock.turn(2, 1);
  clock.advance(0.01);
  const before = clock.clock;
  clock.release(4);
  clock.endTurn(true);
  clock.advance(1);
  assert.equal(clock.clock, before);
  assert.equal(clock.impulse, 0);
  assert.equal(clock.targetClock, null);
});

test("pause and dragging stop the drive, while manual winding still works", () => {
  const clock = new Clockwork();
  clock.paused = true;
  clock.release(6);
  clock.advance(1);
  assert.equal(clock.clock, 0);
  clock.turn(0, 0.2);
  assert.equal(clock.clock, 0.4);
  clock.paused = false;
  clock.dragging = true;
  clock.advance(1);
  assert.equal(clock.clock, 0.4);
  clock.dragging = false;
  clock.advance(0.1);
  assert.ok(clock.clock > 0.4);
  for (const value of [-1, NaN, Infinity])
    assert.throws(() => clock.advance(value));
  clock.reset();
  assert.equal(clock.clock, 0);
  assert.equal(clock.impulse, 0);
});

test("crossing the angle seam never jumps a full revolution", () => {
  assert.ok(
    Math.abs(wrappedDelta(-Math.PI + 0.02, Math.PI - 0.02) - 0.04) < 1e-12,
  );
  assert.ok(
    Math.abs(wrappedDelta(Math.PI - 0.02, -Math.PI + 0.02) + 0.04) < 1e-12,
  );
});
