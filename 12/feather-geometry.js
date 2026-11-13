import { BufferGeometry, Float32BufferAttribute } from 'three/webgpu';
import { randomGenerator } from './random.js';

// Every feather is actual geometry: a tapering shaft, separate curved barbs,
// tiny interlocking barbules, and a loose, three-dimensional downy base.
export function createFeatherGeometry(seed = 12, detail = 1) {
  const random = randomGenerator(seed);
  const positions = [], normals = [], data = [], indices = [];
  const bend = .17 + random() * .16;
  const twist = (random() - .5) * .55;
  const width = .87 + random() * .18;
  const shaft = t => [bend * (t * t * 1.8 - .2), -1.55 + 3.1 * t, .13 * Math.sin(t * Math.PI)];
  const surface = (t, x) => {
    const p = shaft(t);
    return [p[0] + x, p[1], p[2] + x * x * .4 + x * twist * (t - .15)];
  };
  function ribbon(points, radius, pigment, softness = 0, taper = true) {
    const start = positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const xy = Math.hypot(dx, dy) || 1;
      const u = i / (points.length - 1);
      const r = radius * (taper ? Math.pow(1 - u, .55) * .92 + .08 : 1);
      for (const side of [-1, 1]) {
        positions.push(p[0] - dy / xy * r * side, p[1] + dx / xy * r * side, p[2]);
        normals.push(-.8 * p[0], -.06 * p[1], 1);
        data.push(pigment, softness, u);
      }
      if (i < points.length - 1) {
        const n = start + i * 2;
        indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
      }
    }
  }
  // The tiny gaps travel in groups: a few barbs unhook as one, instead of
  // turning the feather into a perfectly regular comb.
  for (const side of [-1, 1]) {
    const count = Math.floor(310 * detail);
    const splits = Array.from({ length: 7 }, () => ({ t: .25 + random() * .67, w: .005 + random() * .009, a: .015 + random() * .025 }));
    for (let i = 0; i < count; i++) {
      const t = .235 + i / (count - 1) * .765;
      const q = (t - .235) / .765;
      const contour = Math.pow(Math.sin(Math.PI * Math.pow(q, .81)), .71);
      let reach = (.47 * contour + .003 * (1 - q)) * width * (side < 0 ? .83 : 1.07);
      const irregular = .97 + .025 * Math.sin(t * 93 + seed) + .018 * Math.sin(t * 271);
      reach *= irregular;
      let split = 0;
      for (const s of splits) split += s.a * Math.exp(-Math.pow((t - s.t) / s.w, 2));
      const rise = Math.min((1 - t) * 2.6, .08 * (1 - q) + .56 * Math.pow(Math.max(0, Math.sin(Math.PI * q)), .65));
      const free = random() < .055;
      const curl = (random() - .5) * (free ? .12 : .013);
      const barb = u => {
        const x = side * reach * u;
        const progress = t + (rise * (.7 * u + .3 * u * u) + split * Math.pow(u, 2) * 2 * Math.min(1, (1 - t) * 7)) / 3.1;
        const p = surface(progress, x);
        p[1] += Math.sin(u * 5 + t * 80) * .004 * u;
        p[2] += curl * u * u + .014 * Math.sin(u * Math.PI);
        return p;
      };
      const pigment = .74 + random() * .25;
      const points = Array.from({ length: 11 }, (_, k) => barb(k / 10));
      ribbon(points, .0049 / detail, pigment, .08);
      // Fine hooks branch from the main barbs. At the edge they break the
      // silhouette into delicate individual threads that catch the backlight.
      const hooks = Math.floor((16 + reach * 18) * detail);
      for (let j = 1; j < hooks; j++) {
        const u = j / hooks, p = barb(u);
        for (const sign of [-1, 1]) {
          const length = (.013 + random() * .022) * (1 - u * .45);
          const end = [p[0] + side * length * .62, p[1] + length * sign, p[2] + (random() - .5) * .008];
          ribbon([p, [(p[0] + end[0]) / 2, (p[1] + end[1]) / 2, p[2] + .002], end], .00052 / Math.sqrt(detail), pigment, .4);
        }
      }
    }
  }
  // The plumulaceous base is unzipped: the barbules spread independently.
  const downCount = Math.floor(44 * detail);
  for (let i = 0; i < downCount; i++) {
    const t = .12 + random() * .26, side = random() < .5 ? -1 : 1;
    const origin = shaft(t);
    const reach = (.2 + random() * .32) * Math.pow(Math.sin((t - .1) / .3 * Math.PI), .4);
    const lift = -.22 + random() * .49;
    const depth = (random() - .5) * .32;
    const phase = random() * 6.28;
    const pAt = u => [origin[0] + side * reach * u, origin[1] + lift * u + Math.sin(u * 3 + phase) * .045 * u, origin[2] + depth * u + Math.sin(u * 4 + phase) * .028 * u];
    ribbon(Array.from({ length: 10 }, (_, k) => pAt(k / 9)), .0016, .88 + random() * .1, 1);
    const branches = Math.floor(22 * detail);
    for (let j = 1; j < branches; j++) {
      const u = j / branches, root = pAt(u);
      const len = (.065 + random() * .11) * Math.sin(u * Math.PI * .87);
      for (const sign of [-1, 1]) {
        const wave = random() * 6.28;
        const points = Array.from({ length: 6 }, (_, k) => {
          const v = k / 5;
          return [root[0] + side * len * v * (.7 + .2 * Math.sin(v * 3 + wave)), root[1] + sign * len * v * .7 + .025 * Math.sin(v * 4 + wave) * v, root[2] + Math.sin(wave) * len * v + .02 * Math.sin(v * 5 + wave) * v];
        });
        ribbon(points, .001, .9 + random() * .1, 1);
      }
    }
  }
  // A closed, elliptical rachis has a real rounded highlight when it rolls.
  const start = positions.length / 3, rings = 85, sides = 8;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, p = shaft(t), r = .013 * Math.pow(1 - t, .8) + .0008;
    for (let k = 0; k <= sides; k++) {
      const angle = k / sides * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle);
      positions.push(p[0] + x * r, p[1], p[2] + z * r * .75 + .009);
      normals.push(x, 0, z);
      data.push(.87, -.3, t);
      if (j < rings && k < sides) {
        const n = start + j * (sides + 1) + k;
        indices.push(n, n + 1, n + sides + 1, n + 1, n + sides + 2, n + sides + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('fiber', new Float32BufferAttribute(data, 3));
  // Ribbon and shaft construction walk clockwise relative to their outward
  // normals. Match the winding before double-sided physical lighting flips
  // back-face normals, otherwise the illuminated side becomes the dark side.
  for (let i = 0; i < indices.length; i += 3) {
    const next = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = next;
  }
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
