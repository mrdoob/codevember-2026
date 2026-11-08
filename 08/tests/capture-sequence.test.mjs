import test from "node:test";
import assert from "node:assert/strict";
import {
  FPS,
  DURATION,
  TOTAL_FRAMES,
  SHOTS,
  frameAt,
} from "../scripts/capture-sequence.js";
import {
  CAMERA_MIN_Y,
  CAMERA_MAX_Y,
  COLUMN_LOCATIONS,
  COLUMN_BASE_WIDTH,
} from "../room-layout.js";

test("the video covers seven long shots with hard cuts", () => {
  assert.equal(TOTAL_FRAMES, DURATION * FPS);
  assert.equal(DURATION, 70);
  assert.equal(SHOTS.length, 7);
  let next = 0;
  for (const shot of SHOTS) {
    assert.equal(shot.startFrame, next);
    assert.ok(shot.frames >= 8 * FPS);
    assert.equal(frameAt(next).shot, shot.name);
    assert.equal(frameAt(next + shot.frames - 1).shot, shot.name);
    if (next > 0) {
      const before = frameAt(next - 1),
        after = frameAt(next);
      const a = before.target.map((value, i) => value - before.position[i]);
      const b = after.target.map((value, i) => value - after.position[i]);
      const cosine =
        a.reduce((sum, value, i) => sum + value * b[i], 0) /
        (Math.hypot(...a) * Math.hypot(...b));
      const angle = Math.acos(Math.max(-1, Math.min(1, cosine)));
      assert.ok(
        Math.hypot(...before.position.map((v, i) => v - after.position[i])) >
          5 || angle > 0.2,
        "Cut must jump directly to the next camera",
      );
    }
    next += shot.frames;
  }
  assert.equal(next, TOTAL_FRAMES);
  assert.throws(() => frameAt(TOTAL_FRAMES), RangeError);
});

test("camera paths stay clear of the floor, ceiling, columns, and installation", () => {
  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    const {
      position: [x, y, z],
      target,
      fov,
    } = frameAt(frame);
    assert.ok(y >= CAMERA_MIN_Y && y <= CAMERA_MAX_Y);
    assert.ok(Math.hypot(x, z) > 8);
    for (const [cx, cz] of COLUMN_LOCATIONS)
      assert.ok(Math.hypot(x - cx, z - cz) > COLUMN_BASE_WIDTH / 2 + 0.5);
    assert.ok(target.every(Number.isFinite));
    assert.ok(fov >= 40 && fov <= 52);
  }
  for (let frame = 0; frame < SHOTS[0].frames; frame++) {
    const [x, y, z] = frameAt(frame).position;
    assert.ok(Math.abs(Math.hypot(x, z) - 36) < 1e-10);
    assert.equal(y, 0.35);
    assert.ok(z < 0, "The orbit keeps the rear view of the installation");
  }
  assert.ok(frameAt(0).position[0] > 9);
  assert.ok(frameAt(SHOTS[0].frames - 1).position[0] < -5);
  const pullback = SHOTS[6];
  for (let frame = pullback.startFrame; frame < TOTAL_FRAMES; frame++) {
    assert.ok(frameAt(frame).position[1] >= 4.8);
  }
  const ceiling = SHOTS[2];
  for (
    let frame = ceiling.startFrame;
    frame < ceiling.startFrame + ceiling.frames;
    frame++
  ) {
    const view = frameAt(frame);
    assert.ok(view.target[1] > 5.5);
    assert.ok(view.target[1] - view.position[1] > 3.5);
  }
  const floor = SHOTS[5];
  for (
    let frame = floor.startFrame;
    frame < floor.startFrame + floor.frames;
    frame++
  ) {
    const view = frameAt(frame);
    assert.ok(view.position[1] - view.target[1] > 4.5);
  }
});

test("the orbit and shots two, four, and six stay level; other shots bank gradually", () => {
  for (const [index, shot] of SHOTS.entries()) {
    const first = frameAt(shot.startFrame);
    const last = frameAt(shot.startFrame + shot.frames - 1);
    const level = index === 0 || index === 1 || index === 3 || index === 5;
    if (!level) assert.ok(Math.abs(last.roll - first.roll) > 0.05);
    for (
      let frame = shot.startFrame;
      frame < shot.startFrame + shot.frames;
      frame++
    ) {
      const view = frameAt(frame);
      if (level) assert.equal(view.roll, 0);
      assert.ok(
        Number.isFinite(view.roll) && Math.abs(view.roll) <= Math.PI / 20,
      );
      if (frame > shot.startFrame)
        assert.ok(Math.abs(view.roll - frameAt(frame - 1).roll) < 0.002);
    }
  }
});
