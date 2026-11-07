import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Quaternion, Texture, Vector3 } from "three/webgpu";
import { createShells } from "../shells.js";
import {
  Journey,
  SHAPES,
  SPIN_RATE,
  OPEN_START,
  MAX_HINGE_TILT,
  OPEN_SHELL_BOUND,
} from "../journey.js";
import { CAMERA_DISTANCE, cameraDirection } from "../camera-motion.js";

test("closed shapes use an unbroken outer mesh and recycle a bounded pool", () => {
  const environment = new Texture();
  const shells = createShells(environment),
    journey = new Journey();
  const settings = { roughness: 0.32 };
  const camera = new PerspectiveCamera(40, 1.2, 0.1, 90);
  const update = () => {
    shells.update(journey, settings);
    cameraDirection(journey.depth, 0, true, camera.position).multiplyScalar(
      CAMERA_DISTANCE,
    );
    camera.lookAt(0, 0, 0);
    shells.updateCameraRange(camera);
  };
  const roots = shells.slots.map((slot) => slot.root);
  const linings = shells.slots.map((slot) => slot.lining);
  const colors = new Set();
  try {
    for (let index = 0; index < SHAPES.length * 2; index++) {
      journey.seek(index);
      update();
      const current = shells.slots.find((slot) => slot.id === index);
      assert.ok(current.solid.visible);
      const color = current.lining.color.getHexString();
      assert.ok(!colors.has(color), `repeated visible lining at ${index}`);
      colors.add(color);
      assert.ok(current.halves.every((half) => !half.pivot.visible));
      journey.seek(index + 0.45);
      update();
      assert.ok(!current.solid.visible);
      assert.ok(current.halves.every((half) => half.pivot.visible));
      assert.equal(
        shells.group.children.length,
        shells.slots.filter((slot) => slot.active).length,
      );
      assert.ok(shells.group.children.length <= 5);
      assert.deepEqual(
        shells.slots.map((slot) => slot.root),
        roots,
      );
      assert.deepEqual(
        shells.slots.map((slot) => slot.lining),
        linings,
      );
      assert.equal(current.lining.color.getHexString(), color);
      assert.ok(
        current.halves.every(
          (half) =>
            half.meshes[1].material === current.lining &&
            half.meshes[3].material === current.lining,
        ),
      );
      for (const slot of shells.slots.filter(
        (slot) => slot.root.visible && slot.id > index,
      )) {
        assert.ok(slot.solid.visible);
        assert.ok(slot.halves.every((half) => !half.pivot.visible));
      }
    }
  } finally {
    shells.dispose();
    environment.dispose();
  }
});

test("departing halves follow straight paths and preserve the original spin", () => {
  const environment = new Texture(),
    shells = createShells(environment),
    journey = new Journey();
  const settings = { roughness: 0.48 },
    delta = 0.01;
  const poses = (id, age) => {
    journey.seek(id + age);
    shells.update(journey, settings);
    shells.group.updateMatrixWorld(true);
    const slot = shells.slots.find((slot) => slot.active && slot.id === id);
    return {
      quaternions: [slot.solid, ...slot.halves.map((half) => half.carrier)].map(
        (object) => object.quaternion.clone(),
      ),
      positions: slot.halves.map((half) =>
        half.carrier.position.clone().multiplyScalar(slot.state.scale),
      ),
    };
  };
  try {
    for (let id = 1; id <= SHAPES.length; id++) {
      let initial;
      for (const age of [
        0,
        OPEN_START - delta / 2,
        0.08,
        0.15,
        0.22,
        0.4,
        0.7,
        1.05,
        1.4,
        1.8,
      ]) {
        const before = poses(id, age),
          after = poses(id, age + delta);
        const turns = before.quaternions.map((q, i) =>
          after.quaternions[i].clone().multiply(q.clone().invert()),
        );
        const speeds = before.quaternions.map(
          (q, i) => q.angleTo(after.quaternions[i]) / delta,
        );
        assert.ok(
          speeds.every((speed) => Math.abs(speed - SPIN_RATE) < 1e-6),
          `spin speed changed at ${id}/${age}`,
        );
        assert.ok(
          turns.slice(1).every((turn) => turn.angleTo(turns[0]) < 1e-6),
          "halves changed the original spin direction or axis",
        );
        if (age <= OPEN_START) continue;
        initial ||= {
          positions: before.positions.map((p) => p.clone().normalize()),
          turns,
        };
        for (let half = 0; half < 2; half++) {
          assert.ok(
            turns[half + 1].angleTo(initial.turns[half + 1]) < 1e-6,
            "rotation changed axis or speed",
          );
          assert.ok(
            before.positions[half]
              .clone()
              .normalize()
              .dot(initial.positions[half]) > 0.999999,
            "departure changed direction",
          );
          assert.ok(
            after.positions[half].length() > before.positions[half].length(),
            "departure stopped",
          );
        }
      }
      for (const boundary of [OPEN_START, 1]) {
        const before = poses(id, boundary - 1e-8),
          after = poses(id, boundary);
        assert.ok(
          before.quaternions.every(
            (q, i) => q.angleTo(after.quaternions[i]) < 1e-6,
          ),
          "release or handoff changed orientation",
        );
      }
    }
  } finally {
    shells.dispose();
    environment.dispose();
  }
});

test("edge hinges stay on the cut rim and tilt the shells outward", () => {
  const environment = new Texture(),
    shells = createShells(environment),
    journey = new Journey();
  const point = new Vector3(),
    hinge = new Vector3(),
    identity = new Quaternion();
  try {
    for (let id = 0; id < SHAPES.length; id++)
      for (const age of [0, 0.3, 0.84, 1.8]) {
        journey.seek(id + age);
        shells.update(journey, { roughness: 0.46 });
        shells.group.updateMatrixWorld(true);
        const slot = shells.slots.find((slot) => slot.active && slot.id === id);
        for (const half of slot.halves) {
          assert.ok(
            Math.hypot(half.anchor.x, half.anchor.z) > 0.5,
            "hinge is still at the center",
          );
          assert.ok(Math.abs(half.anchor.y) < 0.005, "hinge is not on the cut");
          point.copy(half.anchor);
          if (half.sign < 0) {
            point.x *= -1;
            point.y *= -1;
          }
          half.meshes[0].localToWorld(point);
          half.pivot.getWorldPosition(hinge);
          assert.ok(
            point.distanceTo(hinge) < 1e-6,
            "the edge point moves around the pivot",
          );
          const angle = identity.angleTo(half.pivot.quaternion);
          assert.ok(angle <= MAX_HINGE_TILT + 1e-6);
          if (age === 0) assert.ok(angle < 1e-6, "closed shell changed pose");
          else
            assert.ok(
              Math.abs(half.pivot.quaternion.x) > 1e-5 &&
                Math.abs(half.pivot.quaternion.z) > 1e-5,
              "opening lacks X/Z tilt",
            );
          if (age !== 0.84) continue;
          for (const mesh of half.meshes) {
            const positions = mesh.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
              point
                .fromBufferAttribute(positions, i)
                .applyMatrix4(half.body.matrix)
                .applyMatrix4(half.pivot.matrix);
              assert.ok(
                point.y * half.sign >= -1e-5,
                "hinge swings a shell inward through the split plane",
              );
              assert.ok(
                point.length() < OPEN_SHELL_BOUND,
                "hinge exceeds the motion clearance bound",
              );
            }
          }
        }
      }
  } finally {
    shells.dispose();
    environment.dispose();
  }
});
