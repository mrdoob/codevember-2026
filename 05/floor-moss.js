import * as THREE from 'three/webgpu';
import { attribute, cameraViewMatrix, mix, normalWorldGeometry, positionWorld, vec4 } from 'three/tsl';
import { fbm, noise, randomSeed, smoothstep } from './random.js';
import { rockNoise } from './geology.js';
import { mossGrain } from './materials.js';

// The same field shapes the cushions and places their shoots. Bare channels
// run between colonies, and the carpet tapers into the surrounding woodland.
export function floorColonyAt(x, z) {
  const field = fbm(x * .53 + 71, 4, z * .53 - 17, 3)
    + (noise(x * 3.1, 13, z * 3.1) - .5) * .12;
  const coverage = smoothstep(.35, .54, field) * (1 - smoothstep(9, 12, Math.hypot(x, z)));
  const pillows = noise(x * 2.8 + 41, 7, z * 2.8);
  const height = coverage * (.035 + pillows * .15 + noise(x * 7, 6, z * 7) * .035);
  return { coverage, height };
}

function createCarpetGeometry(groundHeight) {
  const positions = [], coverage = [], indices = [];
  const divisions = 240, size = 24;
  for (let j = 0; j <= divisions; j++) for (let i = 0; i <= divisions; i++) {
    const x = i / divisions * size - size / 2, z = j / divisions * size - size / 2;
    const colony = floorColonyAt(x, z);
    positions.push(x, groundHeight(x, z) + colony.height - .004, z);
    coverage.push(colony.coverage);
  }
  for (let j = 0; j < divisions; j++) for (let i = 0; i < divisions; i++) {
    const a = j * (divisions + 1) + i, b = a + 1, c = a + divisions + 1, d = c + 1;
    if (Math.max(coverage[a], coverage[b], coverage[c], coverage[d]) < .025) continue;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function createFloorTuftGeometry(seed) {
  const positions = [], colors = [], shade = [], indices = [], random = randomSeed(seed);
  const olive = new THREE.Color('#405b14'), fresh = new THREE.Color('#7b932b');
  const color = new THREE.Color();
  // Eight compact shoots, each with five closed, keeled leaves. A dark cushion
  // fills the roots; the floor doesn't need the hero moss's detailed stems.
  for (let shoot = 0; shoot < 8; shoot++) {
    const angle = shoot * 2.399963, radius = .052 * Math.sqrt(shoot / 7);
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const height = .027 + random() * .028;
    for (let leaf = 0; leaf < 5; leaf++) {
      const t = leaf / 4, a = angle + leaf * 2.399963;
      const length = (.018 + random() * .014) * (1 - t * .25);
      const width = length * .21, rise = .35 + t * .5;
      const dx = Math.cos(a) * length, dz = Math.sin(a) * length;
      const sideX = -Math.sin(a) * width, sideZ = Math.cos(a) * width;
      const y = height * t, keel = width * .45;
      const start = positions.length / 3;
      const vertices = [[x, y, z],
        [x + dx * .5 + sideX, y + length * rise * .45, z + dz * .5 + sideZ],
        [x + dx * .5, y + length * rise * .45 + keel, z + dz * .5],
        [x + dx * .5 - sideX, y + length * rise * .45, z + dz * .5 - sideZ],
        [x + dx, y + length * rise, z + dz],
        [x + dx * .5, y + length * rise * .45 - .0005, z + dz * .5]];
      color.copy(olive).lerp(fresh, t * .4 + random() * .3);
      for (const vertex of vertices) {
        positions.push(...vertex); colors.push(color.r, color.g, color.b); shade.push(t, 1, .5 + t * .45);
      }
      for (const index of [0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3, 0, 5, 1, 0, 3, 5, 1, 5, 4, 5, 3, 4]) indices.push(start + index);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('pigment', new THREE.Float32BufferAttribute(colors, 3));
  // Mark these as botanical geometry, preserving the same leaf-safe LOD limit
  // and full draw-queue reservation used by the floating colonies.
  geometry.setAttribute('plant', new THREE.Float32BufferAttribute(shade, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function createFloorMoss(groundHeight) {
  const group = new THREE.BundleGroup();
  group.name = 'Forest floor moss';
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .96 });
  const broad = rockNoise({ p: positionWorld.mul(2).add(19) });
  // Analytically filtered grain fades below a pixel instead of adding shimmer.
  const grain = mossGrain({ p: positionWorld.mul(65) });
  material.colorNode = mix(new THREE.Color('#1e2e08'), new THREE.Color('#405516'), broad)
    .mul(grain.w.mul(.35).add(.72));
  material.normalNode = cameraViewMatrix.mul(vec4(normalWorldGeometry.add(grain.xyz.mul(.3)).normalize(), 0)).xyz.normalize();
  const carpet = new THREE.Mesh(createCarpetGeometry(groundHeight), material);
  carpet.name = 'Raised floor moss cushions';
  carpet.castShadow = carpet.receiveShadow = true; group.add(carpet);

  // Use a custom color attribute: r187's meshlet path excludes vertexColors.
  const shootsMaterial = new THREE.MeshStandardNodeMaterial({ roughness: .93 });
  shootsMaterial.colorNode = attribute('pigment', 'vec3');
  shootsMaterial.aoNode = attribute('plant', 'vec3').z;
  const random = randomSeed(5092026), sites = [[], [], []];
  // Concentrate actual leaves in the clearing; the raised carpet supplies the
  // far field. Jitter prevents rows, with denser shoots on established cushions.
  for (let z = -7.2; z <= 7.2; z += .115) for (let x = -7.2; x <= 7.2; x += .115) {
    const px = x + (random() - .5) * .095, pz = z + (random() - .5) * .095;
    const colony = floorColonyAt(px, pz);
    const edge = 1 - smoothstep(6, 8, Math.hypot(px, pz));
    if (colony.coverage < .1 || random() > Math.sqrt(colony.coverage) * edge * .9) continue;
    sites[Math.floor(random() * sites.length)].push({ x: px, z: pz, height: colony.height });
  }
  const meshes = [], transform = new THREE.Object3D(), tint = new THREE.Color();
  for (let variant = 0; variant < sites.length; variant++) {
    const items = sites[variant], geometry = createFloorTuftGeometry(5059 + variant * 73);
    const mesh = new THREE.InstancedMesh(geometry, shootsMaterial, items.length);
    mesh.name = `Floor moss shoots ${variant + 1}`;
    for (const [i, site] of items.entries()) {
      transform.position.set(site.x, groundHeight(site.x, site.z) + site.height - .006, site.z);
      transform.rotation.set((random() - .5) * .22, random() * Math.PI * 2, (random() - .5) * .22);
      transform.scale.setScalar(.8 + random() * .5); transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      const value = .7 + random() * .3;
      mesh.setColorAt(i, tint.setRGB(value * .95, value, value * .85));
    }
    mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
    // Cushion geometry casts the floor's shadows; tiny leaf shadows are covered
    // by basal occlusion, avoiding another dense shadow-map draw.
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere(); group.add(mesh); meshes.push(mesh);
  }
  return { group, carpet, tufts: meshes.reduce((sum, mesh) => sum + mesh.count, 0),
    dispose() {
      carpet.geometry.dispose(); material.dispose(); shootsMaterial.dispose();
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.dispose(); }
    }
  };
}
