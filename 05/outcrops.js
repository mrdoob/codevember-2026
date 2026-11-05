import * as THREE from 'three/webgpu';
import { cameraViewMatrix, mix, normalWorldGeometry, positionWorld, vec4 } from 'three/tsl';
import { randomSeed, noise, smoothstep } from './random.js';
import { rockPoint, STONE_CENTER } from './stone.js';
import { mossGrain } from './materials.js';
import { createOutcropMoss } from './outcrop-moss.js';

// Nearby stones share the hero's geology, with four different silhouettes.
// Distant moss uses an irregular raised surface instead of microscopic shoots.
function createOutcropGeometry(variant, moss) {
  const geometry = new THREE.SphereGeometry(1, 64, 40);
  const positions = geometry.attributes.position, coverage = [];
  const direction = new THREE.Vector3(), point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    direction.fromBufferAttribute(positions, i).normalize();
    const { x, y, z } = direction;
    rockPoint(direction, point).sub(STONE_CENTER);
    const shape = 1 + (noise(x * 2 + variant * 13, y * 2, z * 2) - .5) * .22;
    point.multiplyScalar(shape);
    point.x += y * y * (.12 - variant * .07);
    point.z += x * y * (.08 + variant * .04);
    const field = noise(x * 3 + variant * 17, y * 3 + 9, z * 3);
    const edge = noise(x * 13 + 8, y * 13, z * 13) * .09;
    const mask = smoothstep(.36, .57, field + edge) * smoothstep(-.1, .45, y);
    coverage.push(mask);
    if (moss) point.addScaledVector(direction, .018 + mask * (.10 + field * .07));
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  if (moss) {
    geometry.setAttribute('coverage', new THREE.Float32BufferAttribute(coverage, 1));
    const original = geometry.index.array, indices = [];
    for (let i = 0; i < original.length; i += 3) {
      const a = original[i], b = original[i + 1], c = original[i + 2];
      if ((coverage[a] + coverage[b] + coverage[c]) / 3 > .17) indices.push(a, b, c);
    }
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function createOutcrops(stoneMaterial, groundHeight) {
  const group = new THREE.BundleGroup();
  group.name = 'Mossy outcrops';
  const random = randomSeed(59713), sites = [];
  // Broken clusters leave openings between stones and around the main subject.
  const anchors = [[-3.9, -2.1, .65], [3.7, -3.5, .80], [-1.5, -5.8, .95],
    [-5.8, 2.8, .72], [6.3, 2.0, .9], [1.4, 6.7, .55]];
  for (const [x, z, size] of anchors) {
    sites.push({ x, z, size });
    const angle = random() * Math.PI * 2;
    sites.push({ x: x + Math.cos(angle) * 1.6, z: z + Math.sin(angle) * 1.6, size: size * .36 });
  }
  for (let i = 0; i < 64; i++) {
    const angle = i * 2.399963 + (random() - .5) * .6;
    const radius = 14 + Math.pow(random(), .8) * 38;
    sites.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
      size: .45 + Math.pow(random(), .7) * (.65 + smoothstep(16, 40, radius) * 1.1) });
  }
  const nearbyRandom = randomSeed(50971);
  const pockets = [[-2.7, .6], [1.1, -2.4], [2.9, -1.3], [-.6, 2.3], [2.4, 1.6], [-2.6, -1.8]];
  let smallRocks = 0;
  for (const [cx, cz] of pockets) {
    let placed = 0;
    for (let attempt = 0; attempt < 100 && placed < 6; attempt++) {
      const x = cx + (nearbyRandom() - .5) * 1.6, z = cz + (nearbyRandom() - .5) * 1.4;
      const size = .09 + Math.pow(nearbyRandom(), .8) * .19;
      // Keep the main silhouette clear and leave small gaps within each group.
      if ((x / (2.15 + size * 1.8)) ** 2 + (z / (1.55 + size * 1.8)) ** 2 < 1) continue;
      if (sites.some(site => Math.hypot(x - site.x, z - site.z) < (size + site.size) * 1.6)) continue;
      sites.push({ x, z, size }); placed++; smallRocks++;
    }
  }
  const mossMaterial = new THREE.MeshStandardNodeMaterial({ roughness: .98 });
  const field = mossGrain({ p: positionWorld.mul(3.5).add(17) });
  const grain = mossGrain({ p: positionWorld.mul(85) });
  mossMaterial.colorNode = mix(new THREE.Color('#273b0d'), new THREE.Color('#627922'), field.w).mul(grain.w.mul(.18).add(.785));
  // Analytic slopes avoid the 2×2 pixel blocks from screen-space derivatives
  // of fine noise. Filter both color and slopes below pixel size, and keep the
  // relief shallow so grazing sunlight doesn't turn grains into black pits.
  const gradient = field.xyz.mul(.06).add(grain.xyz.mul(.18));
  const tangent = gradient.sub(normalWorldGeometry.mul(gradient.dot(normalWorldGeometry)));
  const n = normalWorldGeometry.sub(tangent).normalize();
  mossMaterial.normalNode = cameraViewMatrix.mul(vec4(n, 0)).xyz.normalize();
  const geometries = [], meshes = [], surfaces = [], transform = new THREE.Object3D(), point = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let variant = 0; variant < 4; variant++) {
    const stoneGeometry = createOutcropGeometry(variant, false), mossGeometry = createOutcropGeometry(variant, true);
    geometries.push(stoneGeometry, mossGeometry);
    const items = sites.filter((_, i) => i % 4 === variant);
    const stone = new THREE.InstancedMesh(stoneGeometry, stoneMaterial, items.length);
    const moss = new THREE.InstancedMesh(mossGeometry, mossMaterial, items.length);
    stone.name = `Surrounding rocks ${variant + 1}`; moss.name = `Outcrop moss ${variant + 1}`;
    for (let i = 0; i < items.length; i++) {
      const { x, z, size } = items[i];
      transform.position.set(x, 0, z);
      transform.rotation.set((random() - .5) * .35, random() * Math.PI * 2, (random() - .5) * .35);
      transform.scale.set(size * (.8 + random() * .4), size * (.65 + random() * .5), size);
      transform.updateMatrix();
      // Sample the lower surface against the actual terrain, then bury its base.
      let support = -Infinity;
      const positions = stoneGeometry.attributes.position;
      for (let j = 0; j < positions.count; j += 3) {
        point.fromBufferAttribute(positions, j).applyMatrix4(transform.matrix);
        support = Math.max(support, groundHeight(point.x, point.z) - point.y);
      }
      transform.position.y = support - size * .25;
      transform.updateMatrix();
      stone.setMatrixAt(i, transform.matrix); moss.setMatrixAt(i, transform.matrix);
      if (Math.hypot(x, z) < 10) surfaces.push({ geometry: mossGeometry, matrix: transform.matrix.clone() });
      const shade = .67 + random() * .30;
      stone.setColorAt(i, tint.setRGB(shade, shade * 1.02, shade));
      moss.setColorAt(i, tint.setRGB(.75 + random() * .3, .8 + random() * .25, .7 + random() * .3));
    }
    for (const mesh of [stone, moss]) {
      mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere(); group.add(mesh); meshes.push(mesh);
    }
  }
  const shoots = createOutcropMoss(surfaces, groundHeight);
  group.add(shoots.group);
  return { group, count: sites.length, smallRocks, mossTufts: shoots.tufts, mossRocks: shoots.coveredRocks, focusSurfaces: meshes,
    dispose() { shoots.dispose(); meshes.forEach(mesh => mesh.dispose()); geometries.forEach(geometry => geometry.dispose()); mossMaterial.dispose(); }
  };
}
