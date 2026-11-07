import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Raycaster, Texture, Vector3 } from "three/webgpu";
import { createShells } from "../shells.js";
import { Journey, OPEN_START, SPLIT_TIME } from "../journey.js";
import {
  CAMERA_DISTANCE,
  cameraDirection,
  cameraAngles,
} from "../camera-motion.js";

const environment = new Texture(),
  shells = createShells(environment),
  journey = new Journey();
const settings = { roughness: 0.46 };
test.after(() => {
  shells.dispose();
  environment.dispose();
});

test("shells leave the scene exactly two splits later, including after seeking", () => {
  const camera = new PerspectiveCamera(40, 1.2, 0.1, 2000);
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);
  const update = (depth) => {
    journey.seek(depth);
    shells.update(journey, settings);
    shells.updateCameraRange(camera);
    const active = shells.slots.filter((slot) => slot.active);
    assert.equal(shells.group.children.length, active.length);
    assert.ok(active.every((slot) => slot.root.parent === shells.group));
    assert.ok(
      shells.slots
        .filter((slot) => !slot.active)
        .every((slot) => slot.root.parent === null),
    );
    return active.map((slot) => slot.id).sort((a, b) => a - b);
  };
  for (let id = 0; id < 24; id++) {
    assert.ok(
      update(id + 2 - 1e-6).includes(id),
      "shell was removed before the second subsequent split",
    );
    const ids = update(id + 2);
    assert.ok(!ids.includes(id), "shell survived the second subsequent split");
    assert.ok(
      ids.includes(id + 1),
      "the immediate parent was removed too early",
    );
  }
  assert.deepEqual(update(0.5), [0, 1, 2, 3]);
  assert.deepEqual(
    update(1000000000.5),
    [999999999, 1000000000, 1000000001, 1000000002, 1000000003],
  );
  assert.equal(shells.slots.length, 8);
});

test("the central reveal stays clear of opening halves during the orbit", () => {
  const camera = new PerspectiveCamera(40, 1.2, 0.1, 90),
    ray = new Raycaster(),
    direction = new Vector3();
  const poolSize = shells.slots.length;
  for (let index = 0; index < 36; index++)
    for (const phase of [OPEN_START + SPLIT_TIME, 0.65, 0.8, 0.95]) {
      journey.seek(index + phase);
      shells.update(journey, settings);
      cameraDirection(journey.depth, 0, true, camera.position).multiplyScalar(
        CAMERA_DISTANCE,
      );
      camera.lookAt(0, 0, 0);
      shells.updateCameraRange(camera);
      ray.set(
        camera.position,
        direction.copy(camera.position).negate().normalize(),
      );
      ray.far = Infinity;
      const child = shells.slots.find(
        (slot) => slot.active && slot.id === index + 1,
      );
      const target = ray.intersectObject(child.solid, false)[0];
      assert.ok(target, `missing central child at ${journey.depth}`);
      ray.far = target.distance - 0.001;
      const obstacles = shells.slots
        .filter((slot) => slot.active && slot.id <= index)
        .flatMap((slot) => slot.halves.flatMap((half) => half.meshes));
      assert.equal(
        ray.intersectObjects(obstacles, false).length,
        0,
        `blocked reveal at ${journey.depth}`,
      );
      assert.ok(
        shells.slots.length <= poolSize + 1,
        "departing shell pool grows without bound",
      );
    }
});

test("the cut stays oblique through rotation, camera sway, and drag", () => {
  const camera = new PerspectiveCamera(),
    forward = new Vector3(),
    normal = new Vector3();
  for (let id = 0; id < 100; id++)
    for (const age of [0, 0.2, 0.8, 1.4]) {
      journey.seek(id + age);
      shells.update(journey, settings);
      shells.group.updateMatrixWorld(true);
      const slot = shells.slots.find((slot) => slot.active && slot.id === id);
      for (const half of slot.halves) {
        normal.set(0, 1, 0).transformDirection(half.pivot.matrixWorld);
        for (const drag of [-0.1, 0, 0.1])
          for (const amount of [0, 1, 2]) {
            const angles = cameraAngles(journey.depth, amount);
            cameraDirection(
              journey.depth,
              0,
              true,
              camera.position,
            ).multiplyScalar(CAMERA_DISTANCE);
            camera.lookAt(0, 0, 0);
            camera.rotateX(angles.pitch + drag);
            camera.rotateY(angles.lookYaw);
            camera.getWorldDirection(forward);
            const alignment = Math.abs(normal.dot(forward));
            assert.ok(
              alignment > 0.025 && alignment < 0.89,
              `cut lost its oblique angle at ${id}/${age}`,
            );
          }
      }
    }
});

test("the camera has a constant orbit without handoff corrections", () => {
  for (const depth of [
    ...Array.from({ length: 300 }, (_, i) => i + 1),
    1000000000,
  ]) {
    const before = cameraDirection(depth - 1e-7),
      after = cameraDirection(depth);
    assert.ok(before.angleTo(after) < 0.0001, `camera jump at ${depth}`);
    assert.ok(after.toArray().every(Number.isFinite));
    assert.ok(Math.abs(after.length() - 1) < 1e-10);
    assert.equal(after.y, 0);
    const next = cameraDirection(depth + 0.001);
    assert.ok(Math.abs(after.angleTo(next) / 0.001 - 0.72) < 0.0001);
  }
});
