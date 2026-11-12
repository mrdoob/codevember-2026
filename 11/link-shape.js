export const LINK = Object.freeze({
  bend: 0.16,
  halfStraight: 0.17,
  tube: 0.062,
});
export const LINK_PITCH =
  2 * (LINK.bend + LINK.halfStraight - LINK.tube) - 0.006;

// Clockwise racetrack centreline in the XY plane, parameterized by arc length.
export function linkPoint(t, shape = LINK) {
  const { bend: r, halfStraight: h } = shape;
  const arc = Math.PI * r,
    straight = 2 * h;
  let d = (((t % 1) + 1) % 1) * (2 * arc + 2 * straight);
  if (d < arc) {
    const a = d / r;
    return [Math.cos(a) * r, h + Math.sin(a) * r, 0];
  }
  d -= arc;
  if (d < straight) return [-r, h - d, 0];
  d -= straight;
  if (d < arc) {
    const a = Math.PI + d / r;
    return [Math.cos(a) * r, -h + Math.sin(a) * r, 0];
  }
  d -= arc;
  return [r, -h + d, 0];
}

export function colliderPath(arcSegments = 8, shape = LINK) {
  const { bend: r, halfStraight: h } = shape,
    points = [];
  for (let i = 0; i <= arcSegments; i++) {
    const a = (i / arcSegments) * Math.PI;
    points.push([Math.cos(a) * r, h + Math.sin(a) * r, 0]);
  }
  for (let i = 0; i <= arcSegments; i++) {
    const a = Math.PI + (i / arcSegments) * Math.PI;
    points.push([Math.cos(a) * r, -h + Math.sin(a) * r, 0]);
  }
  return points;
}

export function multiplyQuaternion(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function rotateVector(v, q) {
  const [x, y, z] = v,
    [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ];
}

export function alignY(direction) {
  const length = Math.hypot(...direction),
    [x, y, z] = direction.map((n) => n / length);
  if (y < -0.99999) return [1, 0, 0, 0];
  const q = [z, 0, -x, 1 + y],
    norm = Math.hypot(...q);
  return q.map((n) => n / norm);
}
