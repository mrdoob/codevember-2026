import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Scene } from "three/webgpu";
import { createStudio } from "../studio.js";
import { createSettings } from "../settings.js";
import { TARGET_OFFSET } from "../camera-framing.js";
import {
  CAMERA_MAX_DISTANCE,
  CAMERA_MIN_Y,
  CAMERA_MAX_Y,
  FLOOR_Y,
  CEILING_Y,
  CEILING_FIXTURE_DEPTH,
} from "../room-layout.js";

test("floor, ceiling, and repeated services cover the complete outer camera orbit", () => {
  const studio = createStudio(new Scene(), createSettings(1));
  try {
    studio.group.updateMatrixWorld(true);
    const bounds = studio.group.children.map((mesh) => ({
      mesh,
      box: new Box3().setFromObject(mesh),
    }));
    const floor = bounds.find(({ mesh }) => mesh.material === studio.floor).box;
    const deck = bounds.find(
      ({ box }) => Math.abs(box.min.y - CEILING_Y) < 1e-5,
    ).box;
    const services = new Box3();
    for (const { mesh, box } of bounds)
      if (mesh.isInstancedMesh) {
        services.union(box);
        assert.ok(box.min.y >= CEILING_Y - CEILING_FIXTURE_DEPTH);
      }
    assert.ok(!services.isEmpty());
    for (const targetX of [0, TARGET_OFFSET[0]])
      for (let angle = 0; angle < Math.PI * 2; angle += 0.05) {
        const x = targetX + Math.sin(angle) * CAMERA_MAX_DISTANCE,
          z = Math.cos(angle) * CAMERA_MAX_DISTANCE;
        for (const box of [floor, deck, services]) {
          assert.ok(x > box.min.x + 0.5 && x < box.max.x - 0.5);
          assert.ok(z > box.min.z + 0.5 && z < box.max.z - 0.5);
        }
      }
    assert.ok(CAMERA_MIN_Y > FLOOR_Y);
    assert.ok(CAMERA_MAX_Y < CEILING_Y - CEILING_FIXTURE_DEPTH);
  } finally {
    studio.dispose();
  }
});
