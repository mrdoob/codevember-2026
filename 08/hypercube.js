// Coordinates and topology of [-1, 1]^4. No rendering dependencies.
export const VERTICES = Array.from({ length: 16 }, (_, index) =>
  Array.from({ length: 4 }, (_, axis) => (index & (1 << axis) ? 1 : -1)),
);
export const EDGES = [];
for (let index = 0; index < 16; index++) {
  for (let axis = 0; axis < 4; axis++) {
    const other = index ^ (1 << axis);
    if (index < other) EDGES.push([index, other]);
  }
}
export const FACES = [];
for (let u = 0; u < 4; u++) {
  for (let v = u + 1; v < 4; v++) {
    const fixed = [0, 1, 2, 3].filter((axis) => axis !== u && axis !== v);
    for (let signs = 0; signs < 4; signs++) {
      const center = [0, 0, 0, 0];
      fixed.forEach((axis, bit) => {
        center[axis] = signs & (1 << bit) ? 1 : -1;
      });
      const vertices = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => {
        const p = center.slice();
        p[u] = a;
        p[v] = b;
        return p.reduce(
          (index, coordinate, axis) => index | (coordinate > 0 ? 1 << axis : 0),
          0,
        );
      });
      FACES.push({ u, v, center, vertices });
    }
  }
}

export const TAU = Math.PI * 2;
export const LOOP_SECONDS = 80;

// Column-major SO(4) matrix: each factor is an ordinary rotation in a plane.
export function rotation4(
  time,
  mode = "Coupled rotation",
  offsetX = 0,
  offsetY = 0,
) {
  const phase = ((time % LOOP_SECONDS) / LOOP_SECONDS) * TAU;
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const rotate = (a, b, angle) => {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    for (let column = 0; column < 4; column++) {
      const i = column * 4;
      const x = matrix[i + a],
        y = matrix[i + b];
      matrix[i + a] = c * x - s * y;
      matrix[i + b] = s * x + c * y;
    }
  };
  rotate(0, 3, phase + offsetX);
  if (mode === "Coupled rotation")
    rotate(1, 3, Math.sin(phase) * 0.48 + offsetY);
  else if (mode === "Double rotation") rotate(1, 2, phase + offsetY);
  else rotate(1, 3, offsetY);
  rotate(2, 3, mode === "Coupled rotation" ? Math.sin(phase * 2) * 0.23 : 0);
  return matrix;
}

export function transform4(point, matrix) {
  return [0, 1, 2, 3].map((row) =>
    point.reduce((sum, x, column) => sum + x * matrix[column * 4 + row], 0),
  );
}

export function project4(point, distance = 3.6, scale = 1.45) {
  if (!Number.isFinite(distance) || distance <= 2) {
    throw new RangeError(
      "The 4D eye must lie outside the radius-two hypercube.",
    );
  }
  const factor = (scale * (distance - 1)) / (distance - point[3]);
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}
