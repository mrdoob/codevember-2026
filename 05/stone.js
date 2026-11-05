import * as THREE from 'three/webgpu';
import { fbm, noise, smoothstep } from './random.js';

// One scene unit is five centimetres. This unscaled source is about 20 cm across.
export const STONE_SCALE = new THREE.Vector3(1.95, .96, 1.38);
export const STONE_CENTER = new THREE.Vector3(0, .56, 0);

// Intersect weathered fracture planes in the unit rock domain. Their unequal
// offsets make an asymmetric block; a small smooth minimum bevels old edges.
const fractures = [
  [.14, 1, -.10, .88], [-.12, -1, .07, .94],
  [1, .10, .04, .93], [-1, -.07, .12, .99],
  [.13, .16, 1, .88], [-.20, -.03, -1, .92],
  [.74, .64, .31, 1.01], [-.73, .58, .33, 1.02],
  [.39, .67, -.72, .99], [-.46, .72, -.48, 1.04],
  [.78, -.39, .52, 1.01], [-.73, -.36, .65, 1.04],
  [.76, -.34, -.61, 1.03], [-.72, -.42, -.59, 1.02],
  [.72, .09, .72, 1.04], [-.71, .06, .72, 1.04],
  [.74, .05, -.67, 1.02], [-.71, .03, -.73, 1.06]
].map(([x, y, z, offset]) => ({ normal: new THREE.Vector3(x, y, z).normalize(), offset }));

function bevelMin(a, b, radius) {
  const h = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.min(a, b) - h * h * radius * .25;
}

export function rockRadius(d) {
  let radius = 3;
  for (const plane of fractures) {
    const facing = d.dot(plane.normal);
    if (facing > 0) radius = bevelMin(radius, plane.offset / facing, .055);
  }
  return radius;
}

const colonies = [
  [-.66, .67, .3, .39, .20], [-.24, .91, .36, .40, .23],
  [.30, .86, .40, .46, .26], [.73, .51, .45, .32, .20],
  [.35, .35, .87, .29, .19], [-.25, .34, .91, .25, .16],
  [-.74, .19, .65, .26, .16], [.80, .40, -.38, .36, .19],
  [.15, .89, -.43, .32, .24], [-.57, .66, -.51, .34, .17],
  [-.29, .02, .96, .19, .12], [.87, -.02, .49, .18, .12],
  [.02, .55, -.83, .27, .16]
].map(([x, y, z, radius, height]) => ({ direction: new THREE.Vector3(x, y, z).normalize(), radius, height }));

export function rockPoint(d, out = new THREE.Vector3(), widthFactor = 1) {
  const radius = rockRadius(d);
  const x = d.x * radius * STONE_SCALE.x * widthFactor, y = d.y * radius * STONE_SCALE.y, z = d.z * radius * STONE_SCALE.z;
  const erosion = (fbm(x * 3.1 + 12, y * 3.1, z * 3.1) - .45) * .065
    + (fbm(x * 15, y * 15 + 7, z * 15, 3) - .43) * .017;
  const warp = (noise(x * 5 + 8, y * 5, z * 5) - .5) * .045;
  const seamA = x * .43 + y * .77 + z * .31 - .11 + warp;
  const seamB = x * -.58 + y * .23 + z * .71 + .48 + warp * .65;
  const fissure = Math.exp(-Math.pow(seamA / .018, 2)) * .033
    + Math.exp(-Math.pow(seamB / .012, 2)) * .022;
  out.copy(d).multiplyScalar(radius + erosion - fissure).multiply(STONE_SCALE);
  out.x *= widthFactor;
  return out.add(STONE_CENTER);
}

export function colonyAt(d) {
  const edge = (fbm(d.x * 10 + 2, d.y * 10, d.z * 10) - .45) * .14;
  let height = 0, coverage = 0;
  for (const c of colonies) {
    const distance = d.distanceTo(c.direction) + edge;
    const t = Math.max(0, 1 - distance * distance / (c.radius * c.radius));
    height = Math.max(height, Math.pow(t, .68) * c.height);
    coverage = Math.max(coverage, smoothstep(0, .16, t));
  }
  return { height, coverage };
}

export function surfacePoint(d, moss = false, out = new THREE.Vector3(), widthFactor = 1) {
  rockPoint(d, out, widthFactor);
  if (moss) {
    const normal = new THREE.Vector3(d.x / (STONE_SCALE.x * widthFactor), d.y / STONE_SCALE.y, d.z / STONE_SCALE.z).normalize();
    out.addScaledVector(normal, colonyAt(d).height);
  }
  return out;
}

export function surfaceNormal(d, moss = false, widthFactor = 1) {
  const tangent = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < .95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const bitangent = new THREE.Vector3().crossVectors(d, tangent);
  const eps = .001;
  const a = surfacePoint(d.clone().addScaledVector(tangent, eps).normalize(), moss, undefined, widthFactor)
    .sub(surfacePoint(d.clone().addScaledVector(tangent, -eps).normalize(), moss, undefined, widthFactor));
  const b = surfacePoint(d.clone().addScaledVector(bitangent, eps).normalize(), moss, undefined, widthFactor)
    .sub(surfacePoint(d.clone().addScaledVector(bitangent, -eps).normalize(), moss, undefined, widthFactor));
  return a.cross(b).normalize();
}

export function createStoneGeometry(moss = false, width = 288, height = 192, widthFactor = 1) {
  const geometry = new THREE.SphereGeometry(1, width, height);
  const p = geometry.attributes.position, d = new THREE.Vector3();
  const coverage = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    coverage[i] = colonyAt(d).coverage;
    const v = surfacePoint(d, moss, undefined, widthFactor);
    // Bury the substrate just below the shoot roots.
    if (moss) v.addScaledVector(d, -.012);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  if (moss) {
    const original = geometry.index.array, indices = [];
    for (let i = 0; i < original.length; i += 3) {
      const a = original[i], b = original[i + 1], c = original[i + 2];
      if (coverage[a] + coverage[b] + coverage[c] > .08) indices.push(a, b, c);
    }
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
