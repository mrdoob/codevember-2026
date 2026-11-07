import test from "node:test";
import assert from "node:assert/strict";
import {
  createSequence,
  poseAt,
  targetClockAt,
  DURATION,
  FPS,
  TURNS,
  SHOTS,
} from "../scripts/capture-sequence.js";

test("capture completes a 360-degree orbit with matching loop pose and velocity", () => {
  assert.deepEqual(poseAt(0), poseAt(DURATION));
  const { frames } = createSequence();
  assert.equal(frames.length, 1800);
  const first = frames[0],
    last = frames.at(-1),
    second = frames[1];
  for (let axis = 0; axis < 3; axis++) {
    const across = first.position[axis] - last.position[axis];
    const next = second.position[axis] - first.position[axis];
    assert.ok(Math.abs(across - next) < 0.0003);
  }
  assert.ok(
    Math.abs(
      last.azimuth -
        first.azimuth +
        Math.PI * 2 -
        (Math.PI * 2) / frames.length,
    ) < 1e-10,
  );
});

test("view changes are instant cuts and the base shot precedes overhead interactions", () => {
  const framing = (pose) =>
    Math.hypot(...pose.position.map((p, i) => p - pose.target[i]));
  for (const shot of SHOTS) {
    const start = poseAt(shot.start),
      end = poseAt(shot.end - 1 / FPS);
    assert.ok(Math.abs(framing(start) - framing(end)) < 1e-10);
    assert.deepEqual(start.target, end.target);
    if (shot.start)
      assert.ok(
        Math.abs(framing(start) - framing(poseAt(shot.start - 1 / FPS))) > 1,
      );
  }
  assert.match(SHOTS[1].name, /base/);
  assert.match(SHOTS[2].name, /overhead/);
  assert.ok(TURNS[0].start > SHOTS[2].start);
  assert.ok(TURNS[1].start + TURNS[1].duration < SHOTS[2].end);
});

test("winding, wind and lighting return without a loop reset", () => {
  assert.equal(targetClockAt(0), targetClockAt(DURATION));
  const { frames } = createSequence(),
    first = frames[0],
    last = frames.at(-1);
  assert.ok(Math.abs(first.clock - last.clock - 0.35 / FPS) < 1e-9);
  assert.ok(Math.abs(first.wind - last.wind - 1 / FPS) < 1e-6);
  assert.equal(first.daylight, 1);
  assert.equal(last.daylight, 1);
  assert.ok(
    frames.slice(30 * FPS, 54 * FPS).filter((f) => f.daylight < 0.1).length >
      22 * FPS,
  );
  assert.equal(TURNS.length, 5);
  for (const turn of TURNS) assert.ok(frames.some((f) => f.turn === turn));
  for (const f of frames) {
    assert.ok(Math.abs(f.position[0]) < 20 && Math.abs(f.position[2]) < 20);
    assert.ok(f.position[1] < 18.5);
    assert.ok(Number.isFinite(f.clock));
  }
});
