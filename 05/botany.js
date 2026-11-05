import * as THREE from 'three/webgpu';
import { randomSeed, smoothstep } from './random.js';

// Solid, keeled lanceolate leaves. Both faces and the edge are geometry so
// FrontSide rendering can stay on the meshlet path, with no alpha cards.
export function createTuftGeometry(seed, shootCount = 7) {
  const random = randomSeed(seed);
  const positions = [], colors = [], plant = [], indices = [];
  let leaves = 0;
  const olive = new THREE.Color('#4e690b');
  const green = new THREE.Color('#688e12');
  const fresh = new THREE.Color('#a8bb32');
  const brown = new THREE.Color('#45371b');
  function vertex(x, y, z, color, age, tissue, ao) {
    const index = positions.length / 3;
    positions.push(x, y, z);
    colors.push(color.r, color.g, color.b);
    plant.push(age, tissue, ao);
    return index;
  }
  for (let shoot = 0; shoot < shootCount; shoot++) {
    const angle = shoot * 2.399963 + random() * .5;
    const radius = shoot === 0 ? 0 : .028 * Math.sqrt(shoot / (shootCount - 1));
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const height = .044 + random() * .027;
    const bendX = (random() - .5) * .022, bendZ = (random() - .5) * .022;
    const pigment = olive.clone().lerp(green, random());
    const stem = t => new THREE.Vector3(x + bendX * t * t, height * t, z + bendZ * t * t);
    // Tapered brown rhizoid/stem, turning green at its growing tip.
    const offset = positions.length / 3;
    const sides = 5, rings = 4;
    for (let j = 0; j <= rings; j++) {
      const t = j / rings, p = stem(t), r = .00115 * (1 - t * .77);
      const color = brown.clone().lerp(pigment, t);
      for (let k = 0; k < sides; k++) {
        const a = k * Math.PI * 2 / sides;
        vertex(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r, color, t, 0, .3 + t * .65);
      }
    }
    for (let j = 0; j < rings; j++) for (let k = 0; k < sides; k++) {
      const a = offset + j * sides + k, b = offset + j * sides + (k + 1) % sides;
      indices.push(a, a + sides, b, b, a + sides, b + sides);
    }
    const bottom = vertex(x, 0, z, brown, 0, 0, .3);
    const tip = stem(1);
    const top = vertex(tip.x, tip.y, tip.z, pigment, 1, 0, .95);
    for (let k = 0; k < sides; k++) {
      const next = (k + 1) % sides;
      indices.push(bottom, offset + k, offset + next);
      indices.push(top, offset + rings * sides + next, offset + rings * sides + k);
    }
    // Spiral phyllotaxis, with a tight star of erect leaves at the tip.
    const count = 15 + Math.floor(random() * 5);
    for (let leaf = 0; leaf < count; leaf++) {
      const t = .13 + .86 * leaf / (count - 1);
      const azimuth = leaf * 2.399963 + angle + random() * .28;
      const length = (.022 + random() * .012) * (.65 + Math.sin(t * Math.PI) * .35);
      const width = length * (.115 + random() * .045);
      const rising = .17 + t * .64;
      const p = stem(t);
      const outward = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
      const across = new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth));
      const color = pigment.clone().lerp(fresh, smoothstep(.45, 1, t) * (.32 + random() * .24));
      if (t < .3) color.lerp(brown, (1 - t / .3) * .55);
      const start = positions.length / 3;
      const segments = 3;
      const bladePoint = (u, v, side) => {
        const profile = Math.pow(Math.sin(Math.PI * Math.pow(u, .66)), 1.35);
        const extension = length * u * Math.sqrt(1 - rising * rising);
        const lift = length * (u * rising + .20 * Math.sin(Math.PI * u) - .14 * u * u);
        const keel = (1 - Math.abs(v)) * width * profile * .32;
        const thickness = side * .00014 * profile;
        const point = p.clone().addScaledVector(outward, extension).addScaledVector(across, v * width * profile);
        point.y += lift + keel + thickness;
        const leafColor = color.clone().multiplyScalar(v === 0 ? 1.06 : .94);
        return vertex(point.x, point.y, point.z, leafColor, t, 1, .32 + smoothstep(0, .85, t) * .68);
      };
      // Two diamond-section rings retain a closed, curved, keeled leaf with
      // 16 triangles. Saving work within every leaf lets medium-distance LODs
      // retain a complete carpet instead of pruning it into isolated flecks.
      const base = bladePoint(0, 0, 0);
      for (let j = 1; j < segments; j++) {
        const u = j / segments;
        bladePoint(u, -1, 0); bladePoint(u, 0, 1);
        bladePoint(u, 1, 0); bladePoint(u, 0, -1);
      }
      const tip = bladePoint(1, 0, 0), first = start + 1, last = first + (segments - 2) * 4;
      for (let k = 0; k < 4; k++) {
        const next = (k + 1) % 4;
        indices.push(base, first + next, first + k, tip, last + k, last + next);
        for (let j = 0; j < segments - 2; j++) {
          const a = first + j * 4 + k, b = first + j * 4 + next, c = a + 4, d = b + 4;
          indices.push(a, b, c, b, d, c);
        }
      }
      leaves++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('pigment', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('plant', new THREE.Float32BufferAttribute(plant, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // Conservatively include the maximum shader wind displacement.
  geometry.boundingSphere.radius += .012;
  geometry.userData = { shoots: shootCount, leaves, triangles: indices.length / 3 };
  return geometry;
}
