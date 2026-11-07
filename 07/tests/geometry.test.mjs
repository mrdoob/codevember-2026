import { CAMERA_DISTANCE } from "../camera-motion.js";
import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three/webgpu";
import { createGeometries } from "../geometry.js";
import {
  RATIO,
  SHAPES,
  SHELL_BOUND,
  OPEN_SHELL_BOUND,
  SPLIT_DISTANCE,
  SPLIT_TIME,
  OPEN_START,
  MAX_SPLIT_TILT,
  layerState,
} from "../journey.js";

const library = createGeometries();
test.after(() => library.dispose());

for (const [i, shape] of library.shapes.entries())
  test(`${SHAPES[i]} has a closed, consistently wound hollow wall`, () => {
    const edges = new Map();
    let volume = 0;
    for (const name of ["outer", "inner", "rim", "liningRim"]) {
      const g = shape[name],
        p = g.attributes.position,
        n = g.attributes.normal;
      const count = g.index ? g.index.count : p.count;
      assert.ok(count > 0);
      for (let j = 0; j < p.count; j++) {
        assert.ok([p.getX(j), p.getY(j), p.getZ(j)].every(Number.isFinite));
        assert.ok(
          Math.abs(Math.hypot(n.getX(j), n.getY(j), n.getZ(j)) - 1) < 0.002,
        );
      }
      for (let j = 0; j < count; j += 3) {
        const vertices = [0, 1, 2].map((k) => {
          const index = g.index ? g.index.getX(j + k) : j + k;
          return [p.getX(index), p.getY(index), p.getZ(index)];
        });
        const [a, b, c] = vertices;
        volume +=
          (a[0] * (b[1] * c[2] - b[2] * c[1]) +
            a[1] * (b[2] * c[0] - b[0] * c[2]) +
            a[2] * (b[0] * c[1] - b[1] * c[0])) /
          6;
        const keys = vertices.map((v) =>
          v.map((x) => Math.round(x * 1e5)).join(","),
        );
        for (let k = 0; k < 3; k++) {
          const a = keys[k],
            b = keys[(k + 1) % 3];
          if (a === b) continue;
          const key = [a, b].sort().join(":");
          const edge = edges.get(key) || { count: 0, direction: 0 };
          edge.count++;
          edge.direction += a < b ? 1 : -1;
          edges.set(key, edge);
        }
      }
    }
    assert.ok(volume > 0.15 && volume < 0.6, `shell volume: ${volume}`);
    for (const [edge, value] of edges) {
      assert.equal(value.count, 2, `unsealed edge ${edge}`);
      assert.equal(value.direction, 0, `inconsistent winding ${edge}`);
    }
  });

test("every closed container has room for its rotated descendant", () => {
  // Measure the generated inner walls instead of assuming sharp polyhedra.
  let cavityInradius = Infinity,
    largest = 0;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    normal = new Vector3();
  for (const shape of library.shapes) {
    const p = shape.outer.attributes.position;
    for (let i = 0; i < p.count; i++)
      largest = Math.max(largest, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
    const inner = shape.inner.attributes.position;
    for (let i = 0; i < inner.count; i += 3) {
      a.fromBufferAttribute(inner, i);
      b.fromBufferAttribute(inner, i + 1).sub(a);
      c.fromBufferAttribute(inner, i + 2).sub(a);
      normal.crossVectors(b, c);
      if (normal.lengthSq() > 1e-16)
        cavityInradius = Math.min(
          cavityInradius,
          Math.abs(normal.normalize().dot(a)),
        );
    }
  }
  assert.ok(largest * RATIO + 0.02 < cavityInradius);
  // These bounds cover every orientation and every point on the orbit;
  // the application needs no collision detection or corrective steering.
  assert.ok(
    largest < SHELL_BOUND,
    "a primitive exceeds the motion design bound",
  );
  assert.ok(
    SPLIT_DISTANCE > largest * (1 + RATIO),
    "the split does not clear its child",
  );
  const cleared = layerState(0, OPEN_START + SPLIT_TIME * 0.7, 0);
  // Until this point, even the expanded hinge bound cannot reach the camera
  // from the departure line. Afterwards the entire outward half-space is
  // beyond both the camera and the segment joining it to the central reveal.
  assert.ok(
    cleared.scale * OPEN_SHELL_BOUND <
      CAMERA_DISTANCE * Math.cos(MAX_SPLIT_TILT),
    "a split can reach the camera before moving clear",
  );
  assert.ok(
    cleared.scale * cleared.separation >
      CAMERA_DISTANCE * Math.sin(MAX_SPLIT_TILT),
    "an oblique departure can cross the central sightline",
  );
  // Each half stays on the outward side of its cut plane while spinning
  // around the cut normal, so its minimum distance is the separation itself.
  for (const shape of library.shapes)
    for (const name of ["outer", "inner", "rim", "liningRim"]) {
      const p = shape[name].attributes.position;
      for (let i = 0; i < p.count; i++) assert.ok(p.getY(i) >= -1e-6);
    }
  for (let age = 1; age < 2; age += 0.01) {
    const parent = layerState(0, age, 0),
      child = layerState(0, age, 1);
    assert.ok(
      parent.separation > RATIO * (child.separation + OPEN_SHELL_BOUND),
      `parent and child can overlap at ${age}`,
    );
  }
});
