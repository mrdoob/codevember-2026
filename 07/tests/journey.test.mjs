import test from "node:test";
import assert from "node:assert/strict";
import {
  Journey,
  layerState,
  liningColor,
  DURATION,
  BASE_SCALE,
  RATIO,
  SPIN_RATE,
  DRIFT_SPEED,
  OPEN_START,
  SPLIT_TIME,
  SPLIT_SLOWDOWN,
  FADE_START,
  SHELL_LIFETIME,
  SHAPES,
} from "../journey.js";
import { cameraAngles } from "../camera-motion.js";

test("lining colors do not loop with shapes and neighbouring hues stay distinct", () => {
  const seen = new Set();
  for (let id = 0; id < 10000; id++) {
    const pigment = liningColor(id),
      key = JSON.stringify(pigment);
    assert.ok(!seen.has(key), `repeated color at ${id}`);
    seen.add(key);
    assert.ok(pigment.h >= 0 && pigment.h < 1);
    assert.ok(pigment.s >= 0.78 && pigment.s < 0.92);
    assert.ok(pigment.l >= 0.4 && pigment.l < 0.48);
    if (id > 0) {
      const delta = Math.abs(pigment.h - liningColor(id - 1).h);
      assert.ok(Math.min(delta, 1 - delta) > 0.35);
    }
  }
  const late = Array.from({ length: 100 }, (_, i) =>
    liningColor(1000000000 + i),
  );
  assert.equal(new Set(late.map((pigment) => pigment.h)).size, late.length);
  assert.ok(
    late.every((pigment) => Object.values(pigment).every(Number.isFinite)),
  );
});

test("zoom speed stays constant across the handoff", () => {
  const delta = 0.0001;
  const rate = -Math.log(RATIO);
  for (const phase of [0, 0.1, 0.5, 0.9999]) {
    const before = layerState(4, phase, 1);
    const after =
      phase + delta < 1
        ? layerState(4, phase + delta, 1)
        : layerState(5, phase + delta - 1, 0);
    assert.ok(
      Math.abs(Math.log(after.scale / before.scale) / delta - rate) < 1e-8,
    );
  }
});

test("shapes keep spinning before, throughout, and after opening", () => {
  for (const offset of [-1, 0, 1, 2])
    for (const phase of [0.02, 0.15, 0.4, 0.65, 0.98]) {
      const a = layerState(4, phase, offset),
        b = layerState(4, phase + 0.001, offset);
      assert.ok(Math.abs((b.spin - a.spin) / 0.001 + SPIN_RATE) < 1e-9);
    }
});

test("opening eases in and out without stopping the outward motion", () => {
  const position = (age) => layerState(4, age, 0).separation;
  const speed = (age) => (position(age + 0.0001) - position(age)) / 0.0001;
  assert.ok(speed(OPEN_START) < 0.01);
  assert.ok(
    speed(OPEN_START + SPLIT_TIME * 0.5) >
      speed(OPEN_START + SPLIT_TIME * 0.035) * 5,
  );
  assert.ok(
    speed(OPEN_START + SPLIT_TIME * 0.5) >
      speed(OPEN_START + SPLIT_TIME * 0.965) * 4,
  );
  assert.ok(
    Math.abs(
      speed(OPEN_START + SPLIT_SLOWDOWN) - DRIFT_SPEED / SPLIT_SLOWDOWN,
    ) < 0.001,
  );
  for (const age of [0.08, 0.3, 0.59, 1, 1.1, 1.5, 1.95]) {
    const offset = age >= 1 ? -1 : 0,
      phase = age + offset;
    const a = layerState(4, phase, offset),
      b = layerState(4, phase + 0.001, offset);
    assert.ok(b.separation > a.separation, "departure stopped");
  }
});

test("wandering camera angles stay finite and have no jumps at shell handoffs", () => {
  for (const depth of [0, 1, 5, 30, 1000000000]) {
    const a = cameraAngles(depth),
      b = cameraAngles(depth + 0.0001);
    assert.ok(Math.abs(a.pitch) <= 0.04 && Math.abs(a.lookYaw) <= 0.027);
    assert.equal(a.roll, 0);
    for (const key of ["pitch", "lookYaw", "roll", "yaw"]) {
      assert.ok(Number.isFinite(a[key]));
      assert.ok(Math.abs(Math.sin(a[key] - b[key])) < 0.0001);
    }
  }
});

test("every surviving shell has a continuous transform at a layer handoff", () => {
  for (const index of [0, 1, 5, 23, 29, 999999])
    for (let offset = 0; offset <= 3; offset++) {
      const before = layerState(index, 1 - 1e-8, offset);
      const after = layerState(index + 1, 0, offset - 1);
      assert.equal(before.id, after.id);
      assert.equal(before.shape, after.shape);
      assert.equal(before.color, after.color);
      for (const key of [
        "scale",
        "separation",
        "departureTime",
        "hinge",
        "fade",
        "spin",
        "bearing",
        "tilt",
        "spinOffset",
      ]) {
        assert.ok(
          Math.abs(before[key] - after[key]) < 1e-6,
          `${index}/${offset}/${key}`,
        );
      }
    }
});

test("the sequence starts at the third shape and shells finish fading before removal", () => {
  assert.equal(SHAPES[layerState(0, 0, 0).shape], "Hexagonal bipyramid");
  const fading = (age) =>
    layerState(Math.floor(age), age % 1, -Math.floor(age)).fade;
  assert.equal(fading(FADE_START), 0);
  let previous = 0;
  for (let age = FADE_START; age < SHELL_LIFETIME; age += 0.01) {
    const fade = fading(age);
    assert.ok(fade >= previous && fade <= 1);
    previous = fade;
  }
  assert.equal(fading(SHELL_LIFETIME), 1);
  assert.ok(fading(SHELL_LIFETIME - 1e-5) > 0.99999);
});

test("transforms remain bounded after a billion layers", () => {
  for (const index of [0, 1000, 1000000000])
    for (let offset = -1; offset <= 3; offset++)
      for (const phase of [0, 0.3, 0.6, 0.999]) {
        const state = layerState(index, phase, offset);
        for (const value of Object.values(state))
          assert.ok(Number.isFinite(value));
        assert.ok(state.scale >= BASE_SCALE * RATIO ** 3 - 1e-8);
        assert.ok(state.scale <= BASE_SCALE / RATIO ** 2 + 1e-8);
        assert.ok(Math.abs(state.spin) < 8);
        assert.ok(state.separation * state.scale < 50);
      }
});

test("journey preserves fractional time, supports pause, and is independent of frame rate", () => {
  const a = new Journey(),
    b = new Journey();
  for (let i = 0; i < 3600; i++) a.advance(1 / 60);
  for (let i = 0; i < 1800; i++) b.advance(1 / 30);
  assert.ok(Math.abs(a.depth - b.depth) < 1e-10);
  assert.ok(Math.abs(a.depth - 60 / DURATION) < 1e-10);
  a.paused = true;
  const depth = a.depth;
  a.advance(100);
  assert.equal(a.depth, depth);
  a.reset();
  assert.equal(a.depth, 0);
  a.seek(1000000000.25);
  a.paused = false;
  a.advance(DURATION / 2);
  assert.equal(a.index, 1000000000);
  assert.equal(a.phase, 0.75);
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => a.advance(value), RangeError);
    assert.throws(() => a.seek(value), RangeError);
  }
});
