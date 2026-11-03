import * as THREE from 'three/webgpu';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

export const PRIMITIVES = ['Cone', 'Capsule', 'Cube', 'Cylinder', 'Torus', 'Octahedron', 'Sphere'];
const TORUS_RADIUS = 1.05 * 1.3, TORUS_TUBE = 0.42 * 1.3;

export function randomGenerator(seed = 7) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function primitiveGeometry(shape) {
  switch (shape) {
    case 'Cube': return new THREE.BoxGeometry(2.25, 2.25, 2.25);
    case 'Cylinder': return new THREE.CylinderGeometry(1.1, 1.1, 2.6, 32, 1);
    case 'Torus': return new THREE.TorusGeometry(TORUS_RADIUS, TORUS_TUBE, 12, 40);
    case 'Octahedron': return new THREE.OctahedronGeometry(1.65);
    case 'Capsule': return new THREE.CapsuleGeometry(0.9, 1.5, 10, 32);
    case 'Cone': return new THREE.ConeGeometry(1.3, 3, 32);
    default: return new THREE.SphereGeometry(1.35, 32, 20);
  }
}
const key = p => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)},${Math.round(p.z * 1e5)}`;

function facesFromGeometry(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const p = g.attributes.position, n = g.attributes.normal, faces = [];
  for (let i = 0; i < p.count; i += 3) {
    const face = [0, 1, 2].map(j => ({ p: new THREE.Vector3().fromBufferAttribute(p, i + j), n: new THREE.Vector3().fromBufferAttribute(n, i + j) }));
    if (new THREE.Triangle(...face.map(v => v.p)).getArea() > 1e-10) faces.push(face);
  }
  g.dispose(); return faces;
}

// Cut a closed convex volume with a half-space. Every new cut is capped, so
// fracture planes pass through solid interiors instead of extruding a shell.
function clipVolume(faces, normal, constant) {
  const result = [], cutPoints = new Map();
  let outside = false, inside = false;
  for (const face of faces) {
    const polygon = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const da = a.p.dot(normal) - constant, db = b.p.dot(normal) - constant;
      if (da > 1e-7) outside = true; else inside = true;
      if (da <= 1e-7) polygon.push(a);
      if (Math.abs(da) <= 1e-7) cutPoints.set(key(a.p), a.p);
      if ((da < -1e-7 && db > 1e-7) || (da > 1e-7 && db < -1e-7)) {
        const t = da / (da - db);
        const v = { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize() };
        polygon.push(v); cutPoints.set(key(v.p), v.p);
      }
    }
    if (polygon.length >= 3) { polygon.fracture = face.fracture; polygon.interface = face.interface; result.push(polygon); }
  }
  if (!inside) return [];
  if (!outside) return faces;
  if (cutPoints.size >= 3) {
    const points = [...cutPoints.values()], center = new THREE.Vector3();
    points.forEach(p => center.add(p)); center.divideScalar(points.length);
    const n = normal.clone().normalize();
    const u = new THREE.Vector3(Math.abs(n.x) < 0.8 ? 1 : 0, Math.abs(n.x) < 0.8 ? 0 : 1, 0).cross(n).normalize();
    const v = n.clone().cross(u);
    const angle = p => Math.atan2(p.clone().sub(center).dot(v), p.clone().sub(center).dot(u));
    points.sort((a, b) => angle(a) - angle(b));
    const cap = points.map(p => ({ p, n })); cap.fracture = true; result.push(cap);
  }
  return result;
}

function volumeSeeds(shape, count, random) {
  const seeds = [];
  const extent = shape === 'Torus' ? TORUS_RADIUS + TORUS_TUBE : 1.65;
  while (seeds.length < count) {
    const p = new THREE.Vector3((random() * 2 - 1) * extent, (random() * 2 - 1) * extent, (random() * 2 - 1) * extent);
    let inside;
    switch (shape) {
      case 'Cube': inside = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) < 1.125; break;
      case 'Cylinder': inside = Math.hypot(p.x, p.z) < 1.1 && Math.abs(p.y) < 1.3; break;
      case 'Octahedron': inside = Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) < 1.65; break;
      case 'Capsule': inside = Math.hypot(p.x, Math.max(0, Math.abs(p.y) - 0.75), p.z) < 0.9; break;
      case 'Cone': inside = Math.abs(p.y) < 1.5 && Math.hypot(p.x, p.z) < 1.3 * (1.5 - p.y) / 3; break;
      case 'Torus': inside = Math.hypot(Math.hypot(p.x, p.y) - TORUS_RADIUS, p.z) < TORUS_TUBE; break;
      default: inside = p.length() < 1.35;
    }
    if (inside) seeds.push(p);
  }
  return seeds;
}

// The torus is nonconvex. Partition it into closed convex angular wedges first;
// clip every wedge against the same cells, then remove shared internal faces.
function torusVolumes() {
  const volumes = [];
  for (let segment = 0; segment < 40; segment++) {
    const points = [];
    for (const a of [segment / 40 * Math.PI * 2, (segment + 1) / 40 * Math.PI * 2]) {
      for (let j = 0; j < 12; j++) {
        const b = j / 12 * Math.PI * 2, r = TORUS_RADIUS + TORUS_TUBE * Math.cos(b);
        points.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), TORUS_TUBE * Math.sin(b)));
      }
    }
    const g = new ConvexGeometry(points);
    volumes.push(facesFromGeometry(g)); g.dispose();
  }
  return volumes;
}

function makeShard(faces) {
  const unique = new Map();
  for (const face of faces) for (const v of face) unique.set(key(v.p), v.p);
  const center = new THREE.Vector3(); unique.forEach(p => center.add(p)); center.divideScalar(unique.size);
  const positions = [], normals = [], uvs = [], fractureFaces = [], fractureEdges = [];
  let volume = 0, area = 0;
  const bevelNormals = new Map();
  for (const face of faces) for (const v of face) {
    const k = key(v.p);
    if (!bevelNormals.has(k)) bevelNormals.set(k, new THREE.Vector3());
    bevelNormals.get(k).add(v.n);
  }
  bevelNormals.forEach(n => n.normalize());
  function emit(tri, fracture) {
    const a = tri[0].p.clone().sub(center), b = tri[1].p.clone().sub(center), c = tri[2].p.clone().sub(center);
    const triangleArea = new THREE.Triangle(a, b, c).getArea();
    if (triangleArea < 1e-10) return;
    volume += a.dot(b.clone().cross(c)) / 6; area += triangleArea;
    // One projection per triangle prevents UV flips across the bevel normals.
    const faceNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const abs = [Math.abs(faceNormal.x), Math.abs(faceNormal.y), Math.abs(faceNormal.z)];
    for (const { p, n, edge = 0 } of tri) {
      fractureFaces.push(fracture ? 1 : 0); fractureEdges.push(edge);
      positions.push(p.x - center.x, p.y - center.y, p.z - center.z);
      normals.push(n.x, n.y, n.z);
      if (abs[0] >= abs[1] && abs[0] >= abs[2]) uvs.push(p.z * 0.6, p.y * 0.6);
      else if (abs[1] >= abs[2]) uvs.push(p.x * 0.6, p.z * 0.6);
      else uvs.push(p.x * 0.6, p.y * 0.6);
    }
  }
  for (const face of faces) {
    const middle = new THREE.Vector3(); face.forEach(v => middle.add(v.p)); middle.divideScalar(face.length);
    // A narrow interpolated normal band catches light along fracture edges,
    // while the geometry itself remains the exact closed cell volume.
    const inset = face.map(v => ({ p: v.p.clone().lerp(middle, Math.min(0.18, 0.012 / Math.max(v.p.distanceTo(middle), 0.001))), n: v.n }));
    const edge = face.map(v => ({ p: v.p, n: bevelNormals.get(key(v.p)), edge: 1 }));
    for (let i = 1; i < inset.length - 1; i++) emit([inset[0], inset[i], inset[i + 1]], face.fracture);
    for (let i = 0; i < face.length; i++) {
      const j = (i + 1) % face.length;
      emit([edge[i], edge[j], inset[j]], face.fracture); emit([edge[i], inset[j], inset[i]], face.fracture);
    }
  }
  if (volume < 1e-7 || !positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('fractureFace', new THREE.Float32BufferAttribute(fractureFaces, 1));
  geometry.setAttribute('fractureEdge', new THREE.Float32BufferAttribute(fractureEdges, 1));
  // Mean chord length (4V/A) supplies a volume-dependent refraction distance.
  geometry.setAttribute('glassThickness', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3).fill(4 * volume / area), 1));
  geometry.computeBoundingSphere();
  return { geometry, center, volume, support: [...unique.values()].map(p => p.clone().sub(center)) };
}

// Box3D limits each hull to 255 half-edges. Partition complex convex cells
// into smaller volumes, with support simplification bounded to one millimetre.
function collisionVolumes(faces, center, depth = 0) {
  const points = new Map();
  for (const face of faces) for (const v of face) points.set(key(v.p), v.p);
  if (points.size < 4) return []; // A tangent plane has no enclosed volume.
  // Drop numerically redundant support points first. Add the point furthest
  // outside the current hull until its surface is within one millimetre.
  const all = [...points.values()], selected = [];
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const point = all.reduce((a, b) => a.getComponent(axis) * sign > b.getComponent(axis) * sign ? a : b);
    if (!selected.includes(point)) selected.push(point);
  }
  const a = all[0];
  const b = all.reduce((best, p) => p.distanceToSquared(a) > best.distanceToSquared(a) ? p : best);
  const line = b.clone().sub(a).normalize();
  const lineDistance = p => p.clone().sub(a).cross(line).lengthSq();
  const c = all.reduce((best, p) => lineDistance(p) > lineDistance(best) ? p : best);
  const plane = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const planeDistance = p => Math.abs(p.clone().sub(a).dot(plane));
  const d = all.reduce((best, p) => planeDistance(p) > planeDistance(best) ? p : best);
  if (planeDistance(d) < 1e-7) return []; // Ignore zero-volume tangent contacts.
  for (const p of [a, b, c, d]) if (!selected.includes(p)) selected.push(p);
  let error = Infinity;
  while (selected.length <= 40) {
    const reduced = new ConvexHull().setFromPoints(selected);
    let furthest = null; error = 0;
    for (const point of all) {
      const distance = Math.max(...reduced.faces.map(face => face.distanceToPoint(point)));
      if (distance > error) { error = distance; furthest = point; }
    }
    if (error <= 0.001 || selected.length === 40) break;
    selected.push(furthest);
  }
  if (error <= 0.001) return [new Float32Array(selected.flatMap(p => [p.x - center.x, p.y - center.y, p.z - center.z]))];
  if (depth > 12) throw new Error('Could not partition collision hull within tolerance');
  const bounds = new THREE.Box3().setFromPoints(all);
  const size = bounds.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const normal = new THREE.Vector3().setComponent(axis, 1);
  const midpoint = (bounds.min.getComponent(axis) + bounds.max.getComponent(axis)) / 2;
  return [
    ...collisionVolumes(clipVolume(faces, normal, midpoint), center, depth + 1),
    ...collisionVolumes(clipVolume(faces, normal.clone().negate(), -midpoint), center, depth + 1)
  ];
}

export function fractureGeometry(source, count = 64, seed = 7, shape = 'Sphere') {
  const random = randomGenerator(seed);
  const seeds = source.userData.sampleVolume ? Array.from({ length: count }, () => source.userData.sampleVolume(random)) : volumeSeeds(shape, count, random);
  const volumes = source.userData.fractureVolumes || (shape === 'Torus' ? torusVolumes() : [facesFromGeometry(source)]);
  const shards = [];
  for (let cell = 0; cell < seeds.length; cell++) {
    // Near planes first: most distant planes then reject trivially.
    const planes = seeds.map((s, i) => i === cell ? null : { n: s.clone().sub(seeds[cell]), d: (s.lengthSq() - seeds[cell].lengthSq()) / 2 }).filter(Boolean).sort((a, b) => a.n.lengthSq() - b.n.lengthSq());
    const pieces = [];
    for (const original of volumes) {
      let faces = original;
      for (const plane of planes) {
        faces = clipVolume(faces, plane.n, plane.d);
        if (!faces.length) break;
      }
      if (faces.length) pieces.push(faces);
    }
    // A letter cell can intersect disconnected strokes across a hole. Split
    // these into separate bodies; only pieces sharing an actual interface join.
    const groups = source.userData.fractureVolumes ? connectedPieces(pieces) : [pieces];
    for (const group of groups) {
      const faces = group.flat().filter(face => {
        if (face.interface) return false;
        if (shape !== 'Torus') return true;
        const n = face[0].n;
        return !(Math.abs(n.z) < 1e-6 && face.every(v => Math.abs(v.p.dot(n)) < 1e-6));
      });
      if (!faces.length) continue;
      const shard = makeShard(faces);
      if (shard) {
        shard.collisionParts = group.flatMap(part => collisionVolumes(part, shard.center));
        shards.push(shard);
      }
    }
  }
  return shards;
}


function connectedPieces(pieces) {
  const parents = pieces.map((_, i) => i), interfaces = new Map();
  const root = i => parents[i] === i ? i : (parents[i] = root(parents[i]));
  pieces.forEach((faces, i) => {
    for (const face of faces) {
      if (!face.interface) continue;
      let area = 0;
      for (let j = 1; j < face.length - 1; j++) area += new THREE.Triangle(face[0].p, face[j].p, face[j + 1].p).getArea();
      if (area < 1e-9) continue;
      if (interfaces.has(face.interface)) parents[root(i)] = root(interfaces.get(face.interface));
      else interfaces.set(face.interface, i);
    }
  });
  const groups = new Map();
  pieces.forEach((piece, i) => {
    const id = root(i);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(piece);
  });
  return [...groups.values()];
}
