import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three/webgpu";
import {
  CAMERA_OFFSET,
  TARGET_OFFSET,
  CAMERA_ROLL,
  REFERENCE_ASPECT,
  framing,
} from "../camera-framing.js";
import {
  projectedInstallation,
  FLOAT_HEIGHT,
  MIN_PERSPECTIVE,
  MAX_PERSPECTIVE,
} from "../sculpture.js";
import { rotation4 } from "../hypercube.js";

test("a fixed camera contains the floating morph across all modes and viewport shapes", () => {
  for (const aspect of [REFERENCE_ASPECT, 390 / 844]) {
    const { fov, x } = framing(aspect);
    const camera = new PerspectiveCamera(fov, aspect, 0.1, 70);
    camera.position.fromArray(CAMERA_OFFSET);
    camera.position.y += FLOAT_HEIGHT;
    camera.position.x += x - TARGET_OFFSET[0];
    camera.lookAt(new Vector3(x, FLOAT_HEIGHT + TARGET_OFFSET[1], 0));
    camera.rotateZ(CAMERA_ROLL);
    camera.updateMatrixWorld();
    for (const mode of ["Coupled rotation", "Double rotation", "Inside out"])
      for (const d of [MIN_PERSPECTIVE, 3.6, MAX_PERSPECTIVE]) {
        for (const offsets of [
          [0, 0],
          [0.8, -1.1],
          [2.4, 1.9],
        ])
          for (let time = 0; time < 80; time += 2) {
            for (const point of projectedInstallation(
              rotation4(time, mode, ...offsets),
              d,
            )) {
              const p = new Vector3(...point).project(camera);
              assert.ok(
                Math.abs(p.x) < 0.94 && Math.abs(p.y) < 0.94,
                "The morph must fit without moving or resizing the camera",
              );
            }
          }
      }
  }
});

test("portrait composition centers the frame and remains finite at narrow widths", () => {
  for (const aspect of [0.35, 390 / 844, 0.75]) {
    const { fov, x } = framing(aspect);
    assert.ok(x === 0);
    assert.ok(fov > 55 && fov < 180);
  }
  assert.equal(framing(REFERENCE_ASPECT).x, TARGET_OFFSET[0]);
});
