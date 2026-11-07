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
  LIGHTING,
  dragIndicatorAt,
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

test("the drag circle stays visible and travels throughout the held gesture", () => {
  for (const turn of TURNS) {
    const first = dragIndicatorAt(turn.start + 0.2);
    const middle = dragIndicatorAt(turn.start + turn.duration / 2);
    const last = dragIndicatorAt(turn.start + turn.duration - 1 / FPS);
    assert.equal(first.planet, turn.planet);
    assert.equal(middle.opacity, 0.9);
    assert.equal(last.opacity, 0.9);
    assert.ok(
      Math.hypot(...last.position.map((p, i) => p - first.position[i])) > 0.5,
    );
    assert.ok(
      dragIndicatorAt(turn.start + turn.duration + 0.15).opacity <
        last.opacity,
    );
    assert.equal(dragIndicatorAt(turn.start + turn.duration + 0.31), null);
  }
});

test("the base close-up rises smoothly while other shots keep their altitude", () => {
  const { start, end } = SHOTS[1];
  const first = poseAt(start),
    middle = poseAt((start + end) / 2),
    last = poseAt(end - 1 / FPS);
  assert.ok(middle.position[1] > first.position[1]);
  assert.ok(last.position[1] > middle.position[1]);
  assert.ok(last.position[1] - first.position[1] > 2);
  assert.ok(poseAt(start + 1 / FPS).position[1] - first.position[1] < 0.001);
  assert.ok(last.position[1] - poseAt(end - 2 / FPS).position[1] < 0.001);
  for (const shot of SHOTS.filter((_, index) => index !== 1))
    assert.equal(
      poseAt(shot.start).position[1],
      poseAt(shot.end - 1 / FPS).position[1],
    );
});

test("the reverse shot holds daylight before switching to Night, then turns a planet", () => {
  const cut = SHOTS[3].start;
  assert.equal(poseAt(cut - 1 / FPS).daylight, 1);
  assert.equal(poseAt(cut).daylight, 1);
  assert.equal(poseAt(cut + 0.5).daylight, 1);
  assert.equal(LIGHTING.nightStart, cut + 1);
  assert.equal(poseAt(LIGHTING.nightStart).nightSelected, true);
  assert.equal(poseAt(LIGHTING.nightEnd).daylight, 0);
  assert.ok(TURNS[2].start > LIGHTING.nightEnd);
});

test("the 40-second shot looks up from below the planets and the ending stays in the opening framing", () => {
  assert.equal(SHOTS.length, 6);
  for (const time of [40, 45, 50.9]) {
    const pose = poseAt(time);
    assert.ok(pose.position[1] < pose.target[1]);
    assert.ok(pose.position[1] > 1);
  }
  const framing = (pose) => [
    pose.position[1],
    ...pose.target,
    Math.hypot(...pose.position.map((v, i) => v - pose.target[i])),
  ];
  for (const time of [51, 59])
    framing(poseAt(time)).forEach((value, i) =>
      assert.ok(Math.abs(value - framing(poseAt(0))[i]) < 1e-10),
    );
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
      19 * FPS,
  );
  assert.equal(TURNS.length, 5);
  for (const turn of TURNS) assert.ok(frames.some((f) => f.turn === turn));
  for (const f of frames) {
    assert.ok(Math.abs(f.position[0]) < 20 && Math.abs(f.position[2]) < 20);
    assert.ok(f.position[1] < 18.5);
    assert.ok(Number.isFinite(f.clock));
  }
});
