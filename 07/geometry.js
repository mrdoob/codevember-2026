import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const CUT = 0.004;
const METAL_INNER = 0.955;
const LINING_INNER = 0.925;

function addTangents(g) {
  const n = g.attributes.normal,
    tangent = [];
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i),
      z = n.getZ(i),
      length = Math.hypot(x, z);
    if (length > 1e-5) tangent.push(z / length, 0, -x / length, 1);
    else tangent.push(1, 0, 0, 1);
  }
  g.setAttribute("tangent", new THREE.Float32BufferAttribute(tangent, 4));
  return g;
}

function geometry(positions, normals) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.computeBoundingSphere();
  return addTangents(g);
}

// Clip the source triangles, preserving their normals. The inner wall is a
// reversed inset copy. Separate outer and colored bands close the cut, giving
// the lining a real thickness beneath its lightly rounded inner lip.
// No clipping shader, caps, or double-sided surfaces hide a solid primitive.
export function hollowHalf(source) {
  const g = source.index ? source.toNonIndexed() : source;
  const p = g.getAttribute("position"),
    n = g.getAttribute("normal");
  const outerP = [],
    outerN = [],
    innerP = [],
    innerN = [];
  const contour = new Map();
  const emit = (tri) => {
    const a = new THREE.Vector3().fromArray(tri[0].p);
    const b = new THREE.Vector3().fromArray(tri[1].p).sub(a);
    const c = new THREE.Vector3().fromArray(tri[2].p).sub(a);
    if (b.cross(c).lengthSq() < 1e-18) return;
    for (const v of tri) {
      outerP.push(...v.p);
      outerN.push(...v.n);
    }
    for (const v of [...tri].reverse()) {
      innerP.push(
        v.p[0] * LINING_INNER,
        (v.p[1] - CUT) * LINING_INNER + CUT,
        v.p[2] * LINING_INNER,
      );
      innerN.push(...v.n.map((x) => -x));
    }
  };
  for (let i = 0; i < p.count; i += 3) {
    const triangle = [0, 1, 2].map((j) => ({
      p: [p.getX(i + j), p.getY(i + j), p.getZ(i + j)],
      n: [n.getX(i + j), n.getY(i + j), n.getZ(i + j)],
    }));
    const polygon = [];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j],
        b = triangle[(j + 1) % 3];
      const insideA = a.p[1] >= CUT,
        insideB = b.p[1] >= CUT;
      if (insideA) polygon.push(a);
      if (insideA !== insideB) {
        const t = (CUT - a.p[1]) / (b.p[1] - a.p[1]);
        const v = {
          p: a.p.map((x, k) => x + (b.p[k] - x) * t),
          n: a.n.map((x, k) => x + (b.n[k] - x) * t),
        };
        v.p[1] = CUT;
        const length = Math.hypot(...v.n);
        v.n = v.n.map((x) => x / length);
        polygon.push(v);
        contour.set(
          `${Math.round(v.p[0] * 1e6)},${Math.round(v.p[2] * 1e6)}`,
          v.p,
        );
      }
    }
    for (let j = 1; j + 1 < polygon.length; j++)
      emit([polygon[0], polygon[j], polygon[j + 1]]);
  }
  const loop = [...contour.values()].sort(
    (a, b) => Math.atan2(a[2], a[0]) - Math.atan2(b[2], b[0]),
  );
  const radial = loop.map((v, i) => {
    const previous = loop[(i + loop.length - 1) % loop.length],
      next = loop[(i + 1) % loop.length];
    const before = new THREE.Vector2(
      v[0] - previous[0],
      v[2] - previous[2],
    ).normalize();
    const after = new THREE.Vector2(next[0] - v[0], next[2] - v[2]).normalize();
    const tangent = before.add(after).normalize();
    return [tangent.y, -tangent.x];
  });
  function band(profile, profileNormals) {
    const positions = [],
      normals = [],
      indices = [],
      count = loop.length;
    for (let row = 0; row < profile.length; row++)
      for (let i = 0; i < count; i++) {
        const [r, y] = profile[row],
          v = loop[i],
          [nr, ny] = profileNormals[row];
        positions.push(v[0] * r, y, v[2] * r);
        normals.push(radial[i][0] * nr, ny, radial[i][1] * nr);
      }
    for (let row = 0; row < profile.length - 1; row++)
      for (let i = 0; i < count; i++) {
        const a = row * count + i,
          b = row * count + ((i + 1) % count);
        const c = a + count,
          d = b + count;
        indices.push(a, b, c, b, d, c);
      }
    const result = geometry(positions, normals);
    result.setIndex(indices);
    return result;
  }
  // The flat bands share their boundary exactly. Only the outside metal
  // edge and the inside colored edge have a small radius.
  const rim = band(
    [
      [1, CUT],
      [0.9994, 0.002],
      [0.9972, 0.0003],
      [0.996, 0],
      [METAL_INNER, 0],
    ],
    [
      [1, 0],
      [0.8, -0.6],
      [0.4, -0.9165],
      [0, -1],
      [0, -1],
    ],
  );
  const liningRim = band(
    [
      [METAL_INNER, 0],
      [LINING_INNER + 0.004, 0],
      [LINING_INNER + 0.0028, 0.0003],
      [LINING_INNER + 0.0006, 0.002],
      [LINING_INNER, CUT],
    ],
    [
      [0, -1],
      [0, -1],
      [-0.4, -0.9165],
      [-0.8, -0.6],
      [-1, 0],
    ],
  );
  if (g !== source) g.dispose();
  return {
    outer: geometry(outerP, outerN),
    inner: geometry(innerP, innerN),
    rim,
    liningRim,
    contour: loop,
  };
}

// A smooth intersection of the original face planes preserves broad planar
// faces while rolling the silhouette through every edge and vertex. Solving
// along a shared sphere grid keeps the solid and both shell walls watertight.
function roundedPolyhedron(source, rounding) {
  const points = source.attributes.position;
  const unique = new Map();
  const count = source.index ? source.index.count : points.count;
  for (let i = 0; i < count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) =>
      new THREE.Vector3().fromBufferAttribute(
        points,
        source.index ? source.index.getX(i + j) : i + j,
      ),
    );
    const n = b.sub(a).cross(c.sub(a));
    if (n.lengthSq() < 1e-16) continue;
    n.normalize();
    const distance = n.dot(a);
    const key = [n.x, n.y, n.z, distance]
      .map((v) => Math.round(v * 1e5))
      .join(",");
    unique.set(key, { n, distance });
  }
  const planes = [...unique.values()];
  const g = new THREE.SphereGeometry(1, 128, 96);
  const position = g.attributes.position,
    normal = g.attributes.normal;
  const direction = new THREE.Vector3(),
    gradient = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    direction.fromBufferAttribute(position, i).normalize();
    const dots = planes.map((plane) => plane.n.dot(direction));
    let low = 0,
      high = Infinity;
    for (let j = 0; j < planes.length; j++)
      if (dots[j] > 0) high = Math.min(high, planes[j].distance / dots[j]);
    for (let step = 0; step < 26; step++) {
      const radius = (low + high) * 0.5;
      let sum = 0;
      for (let j = 0; j < planes.length; j++)
        sum += Math.exp((radius * dots[j] - planes[j].distance) / rounding);
      if (sum > 1) high = radius;
      else low = radius;
    }
    const radius = (low + high) * 0.5;
    gradient.set(0, 0, 0);
    for (let j = 0; j < planes.length; j++)
      gradient.addScaledVector(
        planes[j].n,
        Math.exp((radius * dots[j] - planes[j].distance) / rounding),
      );
    gradient.normalize();
    position.setXYZ(
      i,
      direction.x * radius,
      direction.y * radius,
      direction.z * radius,
    );
    normal.setXYZ(i, gradient.x, gradient.y, gradient.z);
  }
  source.dispose();
  return g;
}

function roundedCylinder() {
  const profile = [new THREE.Vector2(0, -0.85)];
  for (let i = 0; i <= 12; i++) {
    const angle = ((i / 12) * Math.PI) / 2;
    profile.push(
      new THREE.Vector2(
        0.76 + 0.12 * Math.sin(angle),
        -0.73 - 0.12 * Math.cos(angle),
      ),
    );
  }
  for (let i = 0; i <= 12; i++) {
    const angle = ((i / 12) * Math.PI) / 2;
    profile.push(
      new THREE.Vector2(
        0.76 + 0.12 * Math.cos(angle),
        0.73 + 0.12 * Math.sin(angle),
      ),
    );
  }
  profile.push(new THREE.Vector2(0, 0.85));
  return new THREE.LatheGeometry(profile, 96);
}

function bipyramid() {
  const positions = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2,
      b = ((i + 1) / 6) * Math.PI * 2;
    const p = [1.1 * Math.sin(a), 0, 1.1 * Math.cos(a)];
    const q = [1.1 * Math.sin(b), 0, 1.1 * Math.cos(b)];
    positions.push(0, 1.15, 0, ...p, ...q, 0, -1.15, 0, ...q, ...p);
  }
  const source = new THREE.BufferGeometry();
  source.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  return roundedPolyhedron(source, 0.055);
}

function barrel() {
  const curve = new THREE.CubicBezierCurve(
    new THREE.Vector2(0.6, -0.86),
    new THREE.Vector2(0.88, -0.86),
    new THREE.Vector2(1, -0.55),
    new THREE.Vector2(1, 0),
  );
  const lower = curve.getPoints(24);
  const profile = [
    new THREE.Vector2(0, -0.86),
    ...lower,
    ...lower
      .slice(0, -1)
      .reverse()
      .map((p) => new THREE.Vector2(p.x, -p.y)),
    new THREE.Vector2(0, 0.86),
  ];
  return new THREE.LatheGeometry(profile, 96);
}

export function createGeometries() {
  const sources = [
    new RoundedBoxGeometry(1.62, 1.62, 1.62, 6, 0.21),
    roundedPolyhedron(new THREE.CylinderGeometry(1.22, 1.22, 1.6, 3), 0.055),
    bipyramid(),
    roundedPolyhedron(new THREE.IcosahedronGeometry(1.12), 0.045),
    barrel(),
    roundedPolyhedron(new THREE.CylinderGeometry(1.05, 1.05, 1.6, 6), 0.055),
    roundedPolyhedron(new THREE.DodecahedronGeometry(1.08), 0.065),
    roundedPolyhedron(new THREE.OctahedronGeometry(1.27), 0.075),
    roundedCylinder(),
    new THREE.CapsuleGeometry(0.73, 0.76, 16, 64),
    new THREE.SphereGeometry(1, 96, 64),
  ];
  const shapes = sources.map((source) => {
    const half = hollowHalf(source);
    source.computeBoundingSphere();
    half.solid = addTangents(source);
    return half;
  });
  return {
    shapes,
    dispose() {
      for (const shape of shapes)
        for (const key of ["outer", "inner", "rim", "liningRim", "solid"])
          shape[key].dispose();
    },
  };
}
