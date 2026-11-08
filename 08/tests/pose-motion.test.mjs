import test from "node:test";
import assert from "node:assert/strict";
import {
  poseMotion,
  poseRotation,
  POSE_COUNT,
  POSE_INTERVAL,
  POSE_HOLD,
  POSE_LOOP_SECONDS,
} from "../pose-motion.js";
import { VERTICES, transform4 } from "../hypercube.js";
import { projectedInstallation, FLOAT_HEIGHT } from "../sculpture.js";
import { PerspectiveCamera, Vector3 } from "three/webgpu";
import {
  framing,
  CAMERA_OFFSET,
  TARGET_OFFSET,
  CAMERA_ROLL,
} from "../camera-framing.js";

test("poses hold still, ease in and out, and repeat continuously", () => {
  for (let index = 0; index < POSE_COUNT; index++) {
    const start = index * POSE_INTERVAL;
    for (const offset of [0, 1, POSE_HOLD - 0.001]) {
      const pose = poseMotion(start + offset);
      assert.equal(pose.time, start);
      assert.equal(pose.moving, false);
    }
    const first = poseMotion(start + POSE_HOLD + 0.001);
    const last = poseMotion(start + POSE_INTERVAL - 0.001);
    assert.ok(first.time - start < 1e-6);
    assert.ok(start + POSE_INTERVAL - last.time < 1e-6);
    const middle = poseMotion(start + (POSE_HOLD + POSE_INTERVAL) / 2);
    assert.ok(Math.abs(middle.time - start - POSE_INTERVAL / 2) < 1e-10);
    assert.equal(middle.moving, true);
  }
  for (const time of [-20, -0.001, 0, 5, 39, 79.99]) {
    assert.ok(
      Math.abs(
        poseMotion(time).time - poseMotion(time + POSE_LOOP_SECONDS).time,
      ) < 1e-9,
    );
  }
});

test("angular travel freezes on poses and accelerates the blink clock through each transition", () => {
  for (let index = 0; index < POSE_COUNT; index++) {
    const start = index * POSE_INTERVAL;
    assert.equal(
      poseMotion(start).travel,
      poseMotion(start + POSE_HOLD - 1e-4).travel,
    );
    const a = poseMotion(start + POSE_HOLD + 0.1),
      b = poseMotion(start + 7),
      c = poseMotion(start + POSE_INTERVAL - 0.1);
    assert.ok(b.velocity > a.velocity * 10 && b.velocity > c.velocity * 10);
    const epsilon = 1e-4,
      numerical =
        (poseMotion(start + 7 + epsilon).travel -
          poseMotion(start + 7 - epsilon).travel) /
        (epsilon * 2);
    assert.ok(Math.abs(numerical - b.velocity) < 1e-7);
  }
});

test("all 24 multi-axis poses and their transitions preserve the hypercube and fit the camera", () => {
  const distinct = new Set();
  for (let i = 0; i < POSE_COUNT; i++)
    distinct.add(
      poseRotation(poseMotion(i * POSE_INTERVAL))
        .map((x) => x.toFixed(5))
        .join(),
    );
  assert.equal(distinct.size, 24);
  for (const aspect of [1200 / 675, 390 / 844]) {
    const { fov, x } = framing(aspect),
      camera = new PerspectiveCamera(fov, aspect, 0.1, 70);
    camera.position.fromArray(CAMERA_OFFSET);
    camera.position.y += FLOAT_HEIGHT;
    camera.position.x += x - TARGET_OFFSET[0];
    camera.lookAt(new Vector3(x, FLOAT_HEIGHT + TARGET_OFFSET[1], 0));
    camera.rotateZ(CAMERA_ROLL);
    camera.updateMatrixWorld();
    for (let time = 0; time < POSE_LOOP_SECONDS; time += 0.5) {
      const matrix = poseRotation(poseMotion(time));
      for (const vertex of VERTICES)
        assert.ok(
          Math.abs(
            transform4(vertex, matrix).reduce((s, v) => s + v * v, 0) - 4,
          ) < 1e-10,
        );
      for (const point of projectedInstallation(matrix, 3.6)) {
        const p = new Vector3(...point).project(camera);
        assert.ok(
          Math.abs(p.x) < 0.94 && Math.abs(p.y) < 0.94,
          `Pose at ${time} leaves the camera frame`,
        );
      }
    }
  }
});
