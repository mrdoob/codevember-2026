import { BufferGeometry, Float32BufferAttribute, IcosahedronGeometry, Vector3 } from 'three/webgpu';
import { randomSeed } from './random.js';

class Builder {
  constructor() { this.p = []; this.c = []; this.a = []; this.i = []; }
  vertex(p, color, ao = 1) { const i = this.p.length / 3; this.p.push(p.x, p.y, p.z); this.c.push(...color); this.a.push(ao); return i; }
  triangle(a, b, c) { this.i.push(a, b, c); }
  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('pigment', new Float32BufferAttribute(this.c, 3));
    g.setAttribute('hedgeDetail', new Float32BufferAttribute(this.a, 1));
    g.setIndex(this.i); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}

// Every leaf is a closed, keeled solid. No transparency or billboard foliage.
function leaf(builder, root, direction, length, width, color, ao) {
  const axis = direction.clone().normalize();
  const side = new Vector3().crossVectors(axis, new Vector3(.23, .97, .07)).normalize();
  const normal = new Vector3().crossVectors(axis, side).normalize();
  const belly = root.clone().addScaledVector(axis, length * .46);
  const a = builder.vertex(root, color, ao * .75);
  const b = builder.vertex(belly.clone().addScaledVector(side, width), color, ao);
  const c = builder.vertex(belly.clone().addScaledVector(normal, width * .34), color, ao);
  const d = builder.vertex(belly.clone().addScaledVector(side, -width), color, ao);
  const e = builder.vertex(belly.clone().addScaledVector(normal, -width * .2), color, ao * .7);
  const f = builder.vertex(root.clone().addScaledVector(axis, length), color, ao);
  for (const [i, j] of [[b, c], [c, d], [d, e], [e, b]]) { builder.triangle(a, j, i); builder.triangle(f, i, j); }
}

function branch(builder, start, end, radius, color) {
  const axis = end.clone().sub(start).normalize();
  const side = new Vector3().crossVectors(axis, new Vector3(.07, 1, .03)).normalize();
  const normal = new Vector3().crossVectors(axis, side);
  const base = builder.p.length / 3;
  for (let j = 0; j < 2; j++) for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, r = radius * (j ? .28 : 1);
    builder.vertex((j ? end : start).clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(normal, Math.sin(a) * r), color, .6 + j * .25);
  }
  for (let k = 0; k < 4; k++) { const a = base + k, b = base + (k + 1) % 4; builder.triangle(a, b, a + 4); builder.triangle(b, b + 4, a + 4); }
}

export function createHedgePatch(seed) {
  const random = randomSeed(seed), foliage = new Builder(), snow = new Builder(), snowNormals = [];
  const sphere = new IcosahedronGeometry(1, 1), sp = sphere.attributes.position;
  function snowLobe(center, rx, ry, rz, phase) {
    const first = snow.p.length / 3;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      const lump = 1 + .09 * Math.sin(x * 7 + phase) * Math.cos(z * 9 + y * 6) + .04 * Math.sin(z * 15 + phase);
      const p = new Vector3(center.x + x * rx * lump, center.y + y * ry * lump, center.z + z * rz * lump);
      const tone = .88 + .05 * Math.sin(x * 6 + z * 7 + phase);
      snow.vertex(p, [tone * .87, tone * .94, tone], .65 + .35 * Math.max(0, y));
      const n = new Vector3(x / rx, y / ry, z / rz).normalize();
      const ni = (first + i) * 3; snowNormals[ni] = n.x; snowNormals[ni + 1] = n.y; snowNormals[ni + 2] = n.z;
    }
    for (let i = 0; i < sp.count; i += 3) snow.triangle(first + i, first + i + 1, first + i + 2);
  }
  // Local Z points out of the hedge; Y always follows gravity.
  for (let spray = 0; spray < 22; spray++) {
    const sx = (random() - .5) * .67, sy = (random() - .5) * .65;
    const root = new Vector3(sx * .6, sy - .12, -.09);
    const tip = new Vector3(sx, sy + .15 + random() * .12, .10 + random() * .20);
    const twig = tip.clone().sub(root);
    branch(foliage, root, tip, .006, [.035, .041, .026]);
    const tone = .55 + random() * .8;
    for (let j = 0; j < 18; j++) {
      const t = .15 + j / 21, a = root.clone().addScaledVector(twig, t);
      const side = j % 2 ? 1 : -1;
      const direction = new Vector3(side * (.5 + random() * .3), .2 + random() * .8, .15 + random() * .55);
      const color = [.036 * tone, .055 * tone, .031 * tone];
      const length = .035 + random() * .045, width = .004 + random() * .006;
      leaf(foliage, a, direction, length, width, color, .6 + t * .4);
      if (j % 3 === 0) leaf(foliage, a, new Vector3(side * .35, .5, .65), .045, .006, color, .9);
      if (random() < .88) {
        const snowRoot = a.clone(); snowRoot.y += .009;
        leaf(snow, snowRoot, direction, length * (.84 + random() * .18), width * 1.4, [.74, .81, .88], .65 + t * .35);
        if (j % 7 === 0) snowLobe(snowRoot.clone().addScaledVector(direction, length * .5), width * 1.8, .012 + random() * .012, .02, random() * 20);
      }
    }
    if (random() < .46) {
      const middle = root.clone().lerp(tip, .67); middle.y += .06; middle.z += .018;
      snowLobe(middle, .025 + random() * .035, .025 + random() * .035, .022 + random() * .028, random() * 30);
      if (random() < .4) snowLobe(tip.clone().add(new Vector3(.035, .025, 0)), .018 + random() * .022, .018 + random() * .024, .024, random() * 20);
    }
  }
  // Small powder fragments between the main branch cushions.
  for (let i = 0; i < 8; i++) snowLobe(new Vector3((random() - .5) * .7, (random() - .5) * .67, random() * .2), .016 + random() * .022, .014 + random() * .018, .018 + random() * .022, i);
  sphere.dispose();
  const snowGeometry = snow.geometry();
  const normals = snowGeometry.attributes.normal;
  for (let i = 0; i < normals.count; i++) if (snowNormals[i * 3] !== undefined) normals.setXYZ(i, snowNormals[i * 3], snowNormals[i * 3 + 1], snowNormals[i * 3 + 2]);
  return { foliage: foliage.geometry(), snow: snowGeometry };
}
