import test from "node:test";
import assert from "node:assert/strict";
import { cosineLineIntegral } from "../tube-integral.js";
import {
  projectedInstallation,
  createSculpture,
  FLOOR_Y,
  FLOAT_HEIGHT,
  SCULPTURE_SCALE,
  MIN_PERSPECTIVE,
  MAX_PERSPECTIVE,
  MAX_TUBE_RADIUS,
  DEFAULT_TUBE_RADIUS,
  SURFACE_CLEARANCE,
} from "../sculpture.js";
import {
  rotation4,
  VERTICES,
  EDGES,
  project4,
  transform4,
} from "../hypercube.js";
import { Matrix4, Vector3 } from "three/webgpu";
import {
  CEILING_Y,
  CEILING_FIXTURE_DEPTH,
  ROOM_HALF_WIDTH,
  ROOM_BACK_Z,
  COLUMN_LOCATIONS,
  COLUMN_BASE_WIDTH,
} from "../room-layout.js";

function numerical(a, b, steps = 30000) {
  const direction = b.map((x, i) => x - a[i]),
    length = Math.hypot(...direction);
  const tangent = direction.map((x) => x / length);
  const l = a.reduce((sum, x, i) => sum + x * tangent[i], 0);
  const d = Math.hypot(...a.map((x, i) => x - l * tangent[i]));
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const p = a.map((x, j) => x + (direction[j] * (i + 0.5)) / steps);
    const distance2 = p.reduce((s, x) => s + x * x, 0);
    sum += (2 * d * Math.max(0, p[2])) / (Math.PI * distance2 * distance2);
  }
  return (sum * length) / steps;
}
const close = (a, b, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test("analytic tube diffuse matches numerical integration, including horizon clipping", () => {
  for (const [a, b] of [
    [
      [-2, 0, 2],
      [2, 0, 2],
    ],
    [
      [-1, 2, 0.4],
      [3, 1, 4],
    ],
    [
      [-1, 1, -2],
      [1, 1, 3],
    ],
    [
      [2, 1, 3],
      [-1, -1, -0.5],
    ],
    [
      [0, 1, -1],
      [2, 1, -4],
    ],
    [
      [-5, 0, 0.1],
      [4, 1, 0.2],
    ],
  ])
    close(cosineLineIntegral(a, b), numerical(a, b), 1e-6);
});
test("line reversal, additivity, scale, and distant inverse-square falloff", () => {
  const a = [-2, 1, 3],
    b = [3, 1, 2],
    mid = a.map((x, i) => (x + b[i]) / 2);
  const integral = cosineLineIntegral(a, b);
  close(integral, cosineLineIntegral(b, a));
  close(integral, cosineLineIntegral(a, mid) + cosineLineIntegral(mid, b));
  close(
    integral,
    cosineLineIntegral(
      a.map((x) => x * 4),
      b.map((x) => x * 4),
    ) * 4,
  );
  const near = cosineLineIntegral([-1, 0, 100], [1, 0, 100]);
  const far = cosineLineIntegral([-1, 0, 200], [1, 0, 200]);
  assert.ok(Math.abs(near / far - 4) < 0.001);
  close(cosineLineIntegral([0, 0, 1], [0, 0, 1]), 0);
  close(cosineLineIntegral([0, 0, 1], [0, 0, 2]), 0);
});
test("room fitting preserves the projection with one uniform scale and a fixed origin", () => {
  for (const time of [0, 7, 19, 31, 40, 67])
    for (const perspective of [MIN_PERSPECTIVE, 3.6, MAX_PERSPECTIVE]) {
      const matrix = rotation4(time, "Coupled rotation", 0.7, -1.3);
      const points = projectedInstallation(matrix, perspective);
      const raw = VERTICES.map((point) =>
        project4(transform4(point, matrix), perspective, SCULPTURE_SCALE),
      );
      const origin = new Vector3(0, FLOAT_HEIGHT, 0),
        first = new Vector3(...raw[0]);
      const scale =
        new Vector3(...points[0]).sub(origin).dot(first) / first.lengthSq();
      assert.equal(points.length, 16);
      assert.ok(scale > 0 && scale <= 1);
      points.forEach((point, index) => {
        const expected = new Vector3(...raw[index])
          .multiplyScalar(scale)
          .add(origin);
        assert.ok(expected.distanceTo(new Vector3(...point)) < 1e-10);
      });
    }
});

function clearances([x, y, z], radius) {
  return [
    y - radius - FLOOR_Y,
    CEILING_Y - CEILING_FIXTURE_DEPTH - y - radius,
    ROOM_HALF_WIDTH - Math.abs(x) - radius,
    z - ROOM_BACK_Z - radius,
  ];
}

test("the enlarged morph clears the room, including fittings and manual turns", () => {
  const radius = MAX_TUBE_RADIUS * 2.2;
  for (const mode of ["Coupled rotation", "Double rotation", "Inside out"])
    for (const perspective of [MIN_PERSPECTIVE, 3.6, 4, MAX_PERSPECTIVE]) {
      for (const offsets of [
        [0, 0],
        [0.42, -0.31],
        [1.8, 2.1],
        [4.1, -3.3],
      ])
        for (let time = 0; time < 80; time += 0.5) {
          const points = projectedInstallation(
            rotation4(time, mode, ...offsets),
            perspective,
          );
          for (const point of points) {
            assert.ok(point.every(Number.isFinite));
            assert.ok(
              clearances(point, radius).every(
                (gap) => gap >= SURFACE_CLEARANCE - 1e-9,
              ),
            );
          }
        }
    }
});

test("the resting frame nearly touches both the floor and ceiling", () => {
  const gaps = projectedInstallation(rotation4(0), 3.6).map((p) =>
    clearances(p, DEFAULT_TUBE_RADIUS * 2.2),
  );
  for (const surface of [0, 1]) {
    const gap = Math.min(...gaps.map((g) => g[surface]));
    assert.ok(gap >= SURFACE_CLEARANCE && gap < 0.15);
  }
});

test("all 32 edges have matching neon geometry and area-light endpoints", () => {
  const settings = {
    perspective: 3.6,
    color: "Blue",
    power: 45,
    radius: DEFAULT_TUBE_RADIUS,
    flicker: 0,
    illumination: true,
  };
  const sculpture = createSculpture(settings),
    matrix = new Matrix4();
  assert.equal(sculpture.tubes.count, 32);
  assert.equal(sculpture.joints.count, 16);
  assert.equal(sculpture.lights.length, 32);
  for (const time of [0, 13, 20, 47, 69]) {
    sculpture.update(rotation4(time, "Coupled rotation", 0.3, -0.4));
    EDGES.forEach(([start, end], index) => {
      sculpture.tubes.getMatrixAt(index, matrix);
      const a = new Vector3(0, -0.5, 0).applyMatrix4(matrix),
        b = new Vector3(0, 0.5, 0).applyMatrix4(matrix);
      const light = sculpture.lights[index];
      assert.ok(
        a.distanceTo(light.start) < 1e-6 && b.distanceTo(light.end) < 1e-6,
      );
      assert.ok(
        light.start.distanceTo(new Vector3(...sculpture.vertices[start])) <
          0.015,
      );
      assert.ok(
        light.end.distanceTo(new Vector3(...sculpture.vertices[end])) < 0.015,
      );
      assert.ok(light.intensity > 0);
    });
  }
  sculpture.dispose();
});

test("columns and plinths stay outside the full projected motion envelope", () => {
  const radius = Math.max(
    ...[MIN_PERSPECTIVE, MAX_PERSPECTIVE].map(
      (d) => (2 * SCULPTURE_SCALE * (d - 1)) / Math.sqrt(d * d - 4),
    ),
  );
  for (const [x, z] of COLUMN_LOCATIONS) {
    const distance = Math.hypot(
      Math.abs(x) - COLUMN_BASE_WIDTH / 2,
      Math.abs(z) - COLUMN_BASE_WIDTH / 2,
    );
    assert.ok(distance > radius + MAX_TUBE_RADIUS * 2.2 + SURFACE_CLEARANCE);
  }
});

test("stepped junction fittings stay inside the room throughout the morph", () => {
  const settings = {
    perspective: 3.6,
    color: "Multicolor",
    power: 45,
    radius: MAX_TUBE_RADIUS,
    flicker: 0,
    illumination: true,
  };
  const sculpture = createSculpture(settings),
    matrix = new Matrix4(),
    point = new Vector3();
  const meshes = [
    sculpture.collars,
    sculpture.joints,
    sculpture.sockets,
    sculpture.rings,
  ];
  const corners = meshes.map((mesh) => {
    mesh.geometry.computeBoundingBox();
    const { min, max } = mesh.geometry.boundingBox,
      points = [];
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) points.push(new Vector3(x, y, z));
    return points;
  });
  try {
    for (const mode of ["Coupled rotation", "Double rotation", "Inside out"])
      for (let time = 0; time < 80; time += 5) {
        sculpture.update(rotation4(time, mode, 0.4, -0.3));
        meshes.forEach((mesh, j) => {
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix);
            for (const corner of corners[j]) {
              point.copy(corner).applyMatrix4(matrix);
              assert.ok(
                clearances(point.toArray(), 0).every((gap) => gap > 0),
                "A fitting intersects the room",
              );
            }
          }
        });
      }
  } finally {
    sculpture.dispose();
  }
});
