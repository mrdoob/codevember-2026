import test from "node:test";
import assert from "node:assert/strict";
import {
  EDGES,
  FACES,
  VERTICES,
  LOOP_SECONDS,
  project4,
  rotation4,
  transform4,
} from "../hypercube.js";

const close = (a, b, tolerance = 1e-10) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const squaredLength = (point) =>
  point.reduce((sum, value) => sum + value * value, 0);

test("hypercube topology has 16 vertices, 32 unique edges, and 24 unique square faces", () => {
  assert.equal(new Set(VERTICES.map((point) => point.join())).size, 16);
  assert.equal(new Set(EDGES.map((edge) => edge.join())).size, 32);
  assert.equal(
    new Set(
      FACES.map((face) => [...face.vertices].sort((a, b) => a - b).join()),
    ).size,
    24,
  );
  const degree = new Array(16).fill(0),
    incidence = new Map(EDGES.map((edge) => [edge.join(), 0]));
  for (const [a, b] of EDGES) {
    degree[a]++;
    degree[b]++;
    close(
      squaredLength(
        VERTICES[a].map((value, axis) => value - VERTICES[b][axis]),
      ),
      4,
    );
  }
  for (const face of FACES) {
    for (let i = 0; i < 4; i++) {
      const key = [face.vertices[i], face.vertices[(i + 1) % 4]]
        .sort((a, b) => a - b)
        .join();
      assert.ok(incidence.has(key), "Every face side is a hypercube edge");
      incidence.set(key, incidence.get(key) + 1);
    }
  }
  assert.ok(degree.every((value) => value === 4));
  assert.ok([...incidence.values()].every((value) => value === 3));
});

test("all rotation modes preserve 4D lengths, distances, and orthogonality", () => {
  for (const mode of ["Coupled rotation", "Double rotation", "Inside out"]) {
    for (const time of [0, 0.01, 7, 20, 40, 61.9, 80, 1e9]) {
      const matrix = rotation4(time, mode, 0.29, -0.63);
      const points = VERTICES.map((point) => transform4(point, matrix));
      points.forEach((point) => close(squaredLength(point), 4));
      for (const [a, b] of EDGES)
        close(squaredLength(points[a].map((x, i) => x - points[b][i])), 4);
      for (let a = 0; a < 4; a++)
        for (let b = 0; b < 4; b++) {
          let dot = 0;
          for (let row = 0; row < 4; row++)
            dot += matrix[a * 4 + row] * matrix[b * 4 + row];
          close(dot, a === b ? 1 : 0);
        }
    }
  }
});

test("every mode loops seamlessly, including angular velocity", () => {
  for (const mode of ["Coupled rotation", "Double rotation", "Inside out"]) {
    const first = rotation4(0, mode),
      last = rotation4(LOOP_SECONDS, mode);
    first.forEach((value, i) => close(value, last[i]));
    const epsilon = 1e-4,
      before = rotation4(LOOP_SECONDS - epsilon, mode),
      after = rotation4(epsilon, mode);
    first.forEach((value, i) =>
      close(
        (value - before[i]) / epsilon,
        (after[i] - value) / epsilon,
        0.00001,
      ),
    );
  }
});

test("a half turn exchanges inner and outer cubes", () => {
  const start = VERTICES.map((point) => project4(point));
  const turned = VERTICES.map((point) =>
    project4(transform4(point, rotation4(40, "Inside out"))),
  );
  close(squaredLength(start[0]), squaredLength(turned[8]));
  close(squaredLength(start[8]), squaredLength(turned[0]));
  assert.ok(squaredLength(start[0]) < squaredLength(start[8]));
  assert.ok(squaredLength(turned[0]) > squaredLength(turned[8]));
});

test("projection stays finite and bounded throughout the supported range", () => {
  for (const distance of [2.8, 3.6, 7]) {
    for (let time = 0; time <= 80; time += 0.25) {
      const matrix = rotation4(time, "Coupled rotation", 0.42, -0.31);
      for (const point of VERTICES) {
        const projected = project4(transform4(point, matrix), distance);
        assert.ok(projected.every(Number.isFinite));
        assert.ok(Math.sqrt(squaredLength(projected)) < 2.8);
      }
    }
  }
  assert.throws(() => project4(VERTICES[0], 2), RangeError);
  assert.throws(() => project4(VERTICES[0], NaN), RangeError);
});
