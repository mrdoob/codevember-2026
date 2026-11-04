// UI order is separate from shader/palette IDs so reordering preserves shapes.
export const PRIMITIVES = ['Octahedron', 'Cube', 'Cone', 'Cylinder', 'Capsule', 'Sphere', 'Torus', 'Torus Knot'];
const PRIMITIVE_IDS = Object.freeze({ Cone: 0, Capsule: 1, Cube: 2, Cylinder: 3, Torus: 4, Octahedron: 5, Sphere: 6, 'Torus Knot': 7 });
export const SPACING = .11;
// Butter, ivory, lavender, sage, coral, periwinkle, and dusty rose wax.
export const PALETTE = ['#e3cf85', '#e8dfc7', '#b7a7c9', '#98b97e', '#e69b89', '#a1aed1', '#d7a0bc', '#9ec4cd'];
// Pale peach, rose, blue, and mint interiors, in the same primitive-ID order.
export const CORE_PALETTE = ['#efb58e', '#e9a6b0', '#a4b8e2', '#a8d2b9', '#efb18d', '#9eb9e3', '#e9a4b7', '#9dcbd8'];
export const GRADIENT_COLOR = '#f3edcf';
export const MAX_BLOBS = 4096;

export const KNOT_RADIUS = .35;
export const KNOT_PATH = Array.from({ length: 96 }, (_, i) => {
  const u = i / 96 * Math.PI * 4, radius = .85 * (2 + Math.cos(u * 1.5)) * .5;
  return [radius * Math.cos(u), radius * Math.sin(u), .425 * Math.sin(u * 1.5)].map(Math.fround);
});
const knotSegments = KNOT_PATH.map((a, i) => {
  const b = KNOT_PATH[(i + 1) % KNOT_PATH.length], d = b.map((v, axis) => v - a[axis]);
  return [...a, ...d, 1 / d.reduce((sum, v) => sum + v*v, 0)];
});

function randomRotation() {
  const u = Math.random(), a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 2;
  return [Math.sqrt(1-u)*Math.sin(a), Math.sqrt(1-u)*Math.cos(a), Math.sqrt(u)*Math.sin(b), Math.sqrt(u)*Math.cos(b)];
}

export function rotateVector(x, y, z, q) {
  const tx = 2*(q[1]*z-q[2]*y), ty = 2*(q[2]*x-q[0]*z), tz = 2*(q[0]*y-q[1]*x);
  return [x+q[3]*tx+q[1]*tz-q[2]*ty, y+q[3]*ty+q[2]*tx-q[0]*tz, z+q[3]*tz+q[0]*ty-q[1]*tx];
}

export function sculptureDistance(seed, x, y, z) {
  return primitiveDistance(seed.shape, ...rotateVector(x, y-seed.centerY, z, seed.inverseRotation));
}

function materialNoise(x, y, z, seed) {
  const cell = [x, y, z].map(Math.floor);
  const blend = [x, y, z].map((v, i) => { const f = v - cell[i]; return f*f*(3-2*f); });
  let value = 0;
  for (let corner = 0; corner < 8; corner++) {
    const b = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    let h = seed ^ Math.imul(cell[0]+b[0], 1597334677) ^ Math.imul(cell[1]+b[1], 3812015801) ^ Math.imul(cell[2]+b[2], 2798796415);
    h = Math.imul(h ^ (h >>> 16), 2246822519); h ^= h >>> 13;
    const weight = b.reduce((w, bit, axis) => w * (bit ? blend[axis] : 1-blend[axis]), 1);
    value += ((h >>> 0) / 4294967295) * weight;
  }
  return value;
}

export function heatCapacityAt(x, y, z, seed) {
  const coarse = materialNoise(x*1.6, y*1.6, z*1.6, seed);
  const fine = materialNoise(x*4, y*4, z*4, seed ^ 0x85ebca6b);
  return Math.max(.65, Math.min(1.4, 1 + (coarse*.8 + fine*.2 - .5)*1.7));
}

export function primitiveDistance(shape, x, y, z) {
  switch (shape) {
    case 'Sphere': return Math.hypot(x, y, z) - 1.09;
    case 'Cube': {
      const q = [Math.abs(x) - .82, Math.abs(y) - .82, Math.abs(z) - .82];
      return Math.hypot(...q.map(v => Math.max(0, v))) + Math.min(0, Math.max(...q)) - .06;
    }
    case 'Cylinder': return Math.max(Math.hypot(x, z) - .84, Math.abs(y) - 1.21);
    case 'Capsule': return Math.hypot(Math.max(0, Math.abs(x) - 1.02), y, z) - .72;
    case 'Cone': return Math.max(Math.abs(y) - 1.58, (Math.hypot(x, z) - 1.28 * (1.58 - y) / 3.16) * .927);
    case 'Torus': return Math.hypot(Math.hypot(x, y) - 1, z) - .52;
    case 'Octahedron': return (Math.abs(x) + Math.abs(y) + Math.abs(z) - 1.6) / Math.sqrt(3);
    case 'Torus Knot': {
      let nearest = Infinity;
      for (const s of knotSegments) {
        const px=x-s[0], py=y-s[1], pz=z-s[2];
        const t=Math.max(0,Math.min(1,(px*s[3]+py*s[4]+pz*s[5])*s[6]));
        const dx=px-t*s[3], dy=py-t*s[4], dz=pz-t*s[5];
        nearest=Math.min(nearest,dx*dx+dy*dy+dz*dz);
      }
      return Math.sqrt(nearest)-KNOT_RADIUS;
    }
    default: throw new Error('Unknown primitive: ' + shape);
  }
}

export function sampleSculpture(shape = PRIMITIVES[0], thermalSeed = (Math.random() * 4294967296) >>> 0, rotation = randomRotation()) {
  const group = PRIMITIVE_IDS[shape];
  if (!PRIMITIVES.includes(shape)) throw new Error('Unknown primitive: ' + shape);
  if (rotation.length !== 4 || !rotation.every(Number.isFinite) || Math.hypot(...rotation) < .000001) throw new Error('Invalid rotation');
  const length = Math.hypot(...rotation);
  rotation = Array.from(rotation, v => v / length);
  const inverseRotation = [-rotation[0], -rotation[1], -rotation[2], rotation[3]];
  const positions = [], groups = [], s = SPACING, extent = Math.ceil(1.8 / s);
  for (let y = -extent; y <= extent; y++) for (let z = -extent; z <= extent; z++) for (let x = -extent; x <= extent; x++) {
    const p = [(x + .5) * s, (y + .5) * s, (z + .5) * s];
    const distance = primitiveDistance(shape, ...p);
    if (distance > -.035) continue;
    // Fit the outer sampling layer to the analytic primitive instead of
    // inheriting a cubic grid's staircase silhouette. Counts stay fixed.
    if (distance > -s) {
      const normal = [0,1,2].map(axis => {
        const a=p.slice(), b=p.slice(); a[axis]+=.001; b[axis]-=.001;
        return primitiveDistance(shape,...a)-primitiveDistance(shape,...b);
      });
      const length=Math.hypot(...normal);
      const shift=Math.max(-.035,Math.min(.035,-s*.6-distance));
      if(length>1e-8) for(let axis=0;axis<3;axis++) p[axis]+=normal[axis]/length*shift;
    }
    positions.push(...rotateVector(...p, rotation)); groups.push(group);
  }
  if (!groups.length || groups.length > MAX_BLOBS) throw new Error('Primitive exceeds the fixed blob budget');
  const base = Math.min(...positions.filter((_, i) => i % 3 === 1));
  for (let i = 1; i < positions.length; i += 3) positions[i] += s * .42 - base;
  // Material variation is sampled once and travels with particle identities.
  // A reset repeats the same melt; selecting a new shape gives it a new batch.
  const heatCapacity = new Float32Array(groups.length);
  for (let i = 0; i < heatCapacity.length; i++) heatCapacity[i] = heatCapacityAt(...positions.slice(i*3, i*3+3), thermalSeed);
  return { positions: new Float32Array(positions), groups: new Uint8Array(groups), heatCapacity, thermalSeed, rotation, inverseRotation, spacing: s, shape, centerY:s*.42-base };
}
