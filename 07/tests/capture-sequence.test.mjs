import test from "node:test";
import assert from "node:assert/strict";
import { Texture, Vector3 } from "three/webgpu";
import { Journey, SHAPES, layerState } from "../journey.js";
import { cameraAngles, cameraDirection } from "../camera-motion.js";
import { createShells } from "../shells.js";
import {
  CYCLE_LENGTH,
  FPS,
  DURATION,
  TOTAL_FRAMES,
  SHOTS,
  frameAt,
} from "../scripts/capture-sequence.js";

test("capture shows all eleven shapes once, with no duplicate endpoint frame", () => {
  assert.equal(DURATION, 44);
  assert.equal(TOTAL_FRAMES, DURATION * FPS);
  assert.equal(new Set(SHOTS.map((shot) => shot.shape)).size, SHAPES.length);
  for (const shot of SHOTS) {
    assert.equal(frameAt(shot.startFrame).shape, shot.shape);
    assert.equal(frameAt(shot.startFrame + shot.frames - 1).shape, shot.shape);
    assert.equal(shot.frames, 120);
  }
  assert.equal(frameAt(0).shape, "Hexagonal bipyramid");
  assert.equal(frameAt(TOTAL_FRAMES).shape, frameAt(0).shape);
  assert.ok(frameAt(TOTAL_FRAMES - 1).depth < frameAt(TOTAL_FRAMES).depth);
});

test("capture appearance and shell motion repeat while the normal journey remains unbounded", () => {
  for (const phase of [0, 0.01, 0.5, 0.999])
    for (let offset = -1; offset <= 3; offset++) {
      const a = layerState(CYCLE_LENGTH, phase, offset, CYCLE_LENGTH);
      const b = layerState(CYCLE_LENGTH * 2, phase, offset, CYCLE_LENGTH);
      assert.equal(b.id - a.id, CYCLE_LENGTH);
      for (const key of Object.keys(a).filter((key) => key !== "id"))
        assert.equal(a[key], b[key], key);
      assert.notEqual(
        layerState(CYCLE_LENGTH, phase, offset).color,
        layerState(CYCLE_LENGTH * 2, phase, offset).color,
      );
    }
});

test("periodic camera position, sway, and velocity match across the loop", () => {
  const direction = (depth) =>
    cameraDirection(depth, 0, true, new Vector3(), CYCLE_LENGTH);
  const delta = 1e-4;
  for (const depth of [CYCLE_LENGTH, CYCLE_LENGTH + 0.3, CYCLE_LENGTH * 2]) {
    assert.ok(
      direction(depth).distanceTo(direction(depth + CYCLE_LENGTH)) < 1e-12,
    );
    const a = cameraAngles(depth, 1, CYCLE_LENGTH),
      b = cameraAngles(depth + CYCLE_LENGTH, 1, CYCLE_LENGTH);
    for (const key of ["pitch", "lookYaw", "roll"])
      assert.ok(Math.abs(a[key] - b[key]) < 1e-12);
    const before = direction(depth)
      .sub(direction(depth - delta))
      .divideScalar(delta);
    const after = direction(depth + delta)
      .sub(direction(depth))
      .divideScalar(delta);
    assert.ok(before.distanceTo(after) < 1e-4);
    const prev = cameraAngles(depth - delta, 1, CYCLE_LENGTH),
      next = cameraAngles(depth + delta, 1, CYCLE_LENGTH);
    for (const key of ["pitch", "lookYaw"])
      assert.ok(Math.abs((next[key] - 2 * a[key] + prev[key]) / delta) < 1e-4);
  }
});

test("actual shell colors, edge hinges, and world transforms close at the loop", () => {
  const environment = new Texture(),
    shells = createShells(environment),
    journey = new Journey();
  function sample(depth, cycleLength = CYCLE_LENGTH) {
    journey.seek(depth);
    shells.update(journey, { orbit: true, roughness: 0.46 }, 0, cycleLength);
    shells.group.updateMatrixWorld(true);
    return shells.slots
      .filter((slot) => slot.active)
      .sort((a, b) => a.id - b.id)
      .map((slot) => ({
        color: slot.lining.color.getHexString(),
        anchors: slot.halves.flatMap((half) => half.anchor.toArray()),
        matrices: [
          slot.solid,
          ...slot.halves.flatMap((half) => half.meshes),
        ].flatMap((mesh) => mesh.matrixWorld.toArray()),
      }));
  }
  try {
    for (const phase of [0, 0.25, 0.6, 0.999]) {
      const a = sample(CYCLE_LENGTH + phase),
        b = sample(CYCLE_LENGTH * 2 + phase);
      assert.equal(a.length, 5);
      for (let i = 0; i < a.length; i++) {
        assert.equal(a[i].color, b[i].color);
        assert.deepEqual(a[i].anchors, b[i].anchors);
        assert.ok(
          a[i].matrices.every(
            (value, j) => Math.abs(value - b[i].matrices[j]) < 1e-11,
          ),
        );
      }
    }
    const repeating = sample(CYCLE_LENGTH + 0.25);
    const endless = sample(CYCLE_LENGTH + 0.25, 0);
    assert.notEqual(
      repeating[1].color,
      endless[1].color,
      "capture appearances leaked into normal playback",
    );
  } finally {
    shells.dispose();
    environment.dispose();
  }
});
