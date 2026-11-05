import * as THREE from 'three/webgpu';
import { attribute, cameraViewMatrix, mix, normalWorldGeometry, positionWorld, uv, vec3, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, noise, randomSeed, smoothstep } from './random.js';
import { rockNoise, rockGrain, reliefNormal } from './geology.js';
import { createStoneGeometry, STONE_CENTER } from './stone.js';
import { createOutcrops } from './outcrops.js';
import { createFloorMoss } from './floor-moss.js';

export function groundHeight(x, z) {
  const radius = Math.hypot(x, z);
  const hollow = Math.exp(-Math.pow((x - 5 - Math.sin(z * .07) * 3) / 4.5, 2));
  return -.31 + (fbm(x * .28 + 13, 0, z * .28) - .44) * 1.4 * smoothstep(2.2, 7, radius)
    + (1.8 + fbm(x * .07 + 31, 0, z * .07) * 5 - hollow * 2.8) * smoothstep(7, 40, radius)
    + (noise(x * 11, 3, z * 11) - .5) * .025;
}

export function createTerrainGeometry(size = 80, divisions = 160) {
  const positions = [], indices = [];
  // Concentrate samples around the subject; distant ground needs less detail.
  const remap = t => Math.sign(t) * Math.pow(Math.abs(t), 2.4) * size;
  for (let j = 0; j <= divisions; j++) for (let i = 0; i <= divisions; i++) {
    const x = remap(i / divisions * 2 - 1), z = remap(j / divisions * 2 - 1);
    positions.push(x, groundHeight(x, z), z);
  }
  for (let j = 0; j < divisions; j++) for (let i = 0; i < divisions; i++) {
    const a = j * (divisions + 1) + i, b = a + 1, c = a + divisions + 1, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createLeafGeometry(seed = 0) {
  const random = randomSeed(seed), positions = [], uvs = [], indices = [];
  const segments = 8, width = .14 + random() * .05;
  for (let side = 0; side < 2; side++) for (let j = 0; j <= segments; j++) {
    const t = j / segments, shape = Math.pow(Math.sin(Math.PI * t), .8) * (.9 + random() * .1);
    for (let k = -1; k <= 1; k++) {
      positions.push(k * width * Math.max(.003, shape),
        Math.sin(Math.PI * t) * (.045 + (1 - Math.abs(k)) * .038) + Math.pow(t, 3) * .08 + (side ? -.001 : .001), t);
      uvs.push((k + 1) * .5, t);
    }
  }
  const layer = (segments + 1) * 3;
  for (let side = 0; side < 2; side++) for (let j = 0; j < segments; j++) for (let k = 0; k < 2; k++) {
    const a = side * layer + j * 3 + k, b = a + 1, c = a + 3;
    if (side === 0) indices.push(a, c, b, b, c, c + 1);
    else indices.push(a, b, c, b, c + 1, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSprayGeometry() {
  const parts = [], random = randomSeed(551);
  for (let j = 0; j < 14; j++) for (const side of [-1, 1]) {
    const t = j / 14;
    const leaf = createLeafGeometry(j + 40);
    const length = (.40 - t * .24) * (.8 + random() * .2);
    leaf.scale(length, length, length);
    leaf.rotateY(side * (1.15 - t * .35));
    leaf.translate(side * .008, Math.sin(t * Math.PI) * .18, t * 1.1);
    parts.push(leaf);
  }
  const result = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  result.computeBoundingSphere();
  return result;
}

function createCrownGeometry() {
  // Eight triangles per thin, folded blade. Open space between leaves gives
  // the canopy a broken silhouette and small highlights when it is defocused.
  const positions = [], colors = [], indices = [], random = randomSeed(1298);
  const matrix = new THREE.Matrix4(), transform = new THREE.Object3D(), point = new THREE.Vector3();
  const dark = new THREE.Color('#20371c'), light = new THREE.Color('#687d37'), color = new THREE.Color();
  for (let i = 0; i < 240; i++) {
    const branch = Math.floor(i / 20), t = (i % 20) / 20;
    const a = branch * 2.399963, r = .18 + t * .9;
    transform.position.set(Math.cos(a) * r + (random() - .5) * .25,
      Math.sin(branch * 8.3) * .32 + Math.sin(t * Math.PI) * .18 + (random() - .5) * .22,
      Math.sin(a) * r + (random() - .5) * .25);
    transform.rotation.set((random() - .5) * 1.4, a + (i % 2 ? -1 : 1) * .8, (random() - .5) * 1.2);
    const length = .20 + random() * .18;
    transform.scale.set(length * (.25 + random() * .16), length, length);
    transform.updateMatrix(); matrix.copy(transform.matrix);
    color.copy(dark).lerp(light, random() ** .65);
    const offset = positions.length / 3;
    for (const v of [[0, 0, 0], [-1, .08, .42], [0, .18, .43], [1, .08, .42], [0, .02, 1], [0, .16, .43]]) {
      point.set(...v).applyMatrix4(matrix); positions.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
    }
    for (const index of [0, 2, 1, 0, 3, 2, 1, 2, 4, 2, 3, 4, 0, 1, 5, 0, 5, 3, 1, 4, 5, 5, 4, 3]) indices.push(offset + index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('forestTint', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function createWoodland(stoneMaterial) {
  const group = new THREE.Group();
  group.name = 'Procedural woodland';
  const staticPlants = new THREE.BundleGroup();
  staticPlants.name = 'Static woodland geometry';
  group.add(staticPlants);
  const geometries = [], materials = [], instances = [];
  const keepGeometry = geometry => { geometries.push(geometry); return geometry; };
  const keepMaterial = material => { materials.push(material); return material; };
  const random = randomSeed(2026110502), transform = new THREE.Object3D();
  const makeInstances = (name, geometry, material, count) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name; instances.push(mesh); staticPlants.add(mesh); return mesh;
  };
  const finish = mesh => {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
  const terrainMaterial = keepMaterial(new THREE.MeshStandardNodeMaterial({ roughness: 1 }));
  const broad = rockNoise({ p: positionWorld.mul(.75).add(13) });
  const loam = rockGrain({ p: positionWorld.mul(36) });
  const fine = rockGrain({ p: positionWorld.mul(210) });
  const groundMoss = rockNoise({ p: positionWorld.mul(.85).add(47) }).smoothstep(.34, .64);
  const earth = mix(new THREE.Color('#30332a'), new THREE.Color('#655e49'), broad);
  // Broad canopy shade with smaller sun flecks, fading around the main stone
  // where the real shadow map supplies the contact and leaf shadows.
  const canopyShade = rockNoise({ p: positionWorld.mul(.38).add(92) }).smoothstep(.47, .68).mul(.7).add(.22);
  const shadeWeight = positionWorld.xz.length().smoothstep(3, 12);
  terrainMaterial.colorNode = mix(earth, new THREE.Color('#475b27'), groundMoss.mul(.85))
    .mul(loam.w.mul(.3).add(.75)).mul(mix(1, canopyShade, shadeWeight));
  // Project the analytic world-space slope onto the surface tangent plane.
  // Shallow relief keeps grazing light from turning soil grains into dark pits.
  const groundGradient = loam.xyz.mul(.2).add(fine.xyz.mul(.07));
  const tangent = groundGradient.sub(normalWorldGeometry.mul(groundGradient.dot(normalWorldGeometry)));
  const groundNormal = normalWorldGeometry.sub(tangent).normalize();
  terrainMaterial.normalNode = cameraViewMatrix.mul(vec4(groundNormal, 0)).xyz.normalize();
  const ground = new THREE.Mesh(keepGeometry(createTerrainGeometry()), terrainMaterial);
  ground.name = 'Forest soil'; ground.receiveShadow = true; staticPlants.add(ground);

  const outcrops = createOutcrops(stoneMaterial, groundHeight);
  group.add(outcrops.group);
  const floorMoss = createFloorMoss(groundHeight);
  group.add(floorMoss.group);

  const pebbleGeometry = keepGeometry(createStoneGeometry(false, 36, 24));
  pebbleGeometry.translate(-STONE_CENTER.x, -STONE_CENTER.y, -STONE_CENTER.z);
  const pebbles = makeInstances('Weathered pebbles', pebbleGeometry, stoneMaterial, 650);
  const pebbleTint = new THREE.Color();
  for (let i = 0; i < pebbles.count; i++) {
    const angle = random() * Math.PI * 2, radius = 2.2 + Math.pow(random(), .7) * 19;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const size = .018 + Math.pow(random(), 3) * .20;
    transform.position.set(x, groundHeight(x, z) + size * .12, z);
    transform.rotation.set((random() - .5) * .25, random() * 6.28, (random() - .5) * .25);
    transform.scale.set(size, size * (.7 + random() * .4), size);
    transform.updateMatrix(); pebbles.setMatrixAt(i, transform.matrix);
    const shade = .45 + random() * .4;
    pebbles.setColorAt(i, pebbleTint.setRGB(shade, shade, shade * .94));
  }
  pebbles.castShadow = pebbles.receiveShadow = true; finish(pebbles);

  const litterMaterial = keepMaterial(new THREE.MeshStandardNodeMaterial({ roughness: .96 }));
  const litter = makeInstances('Fallen leaves', keepGeometry(createLeafGeometry(41)), litterMaterial, 1500);
  const litterColors = ['#4d3821', '#665130', '#393825', '#816340', '#453022'].map(color => new THREE.Color(color));
  for (let i = 0; i < litter.count; i++) {
    const angle = random() * Math.PI * 2, radius = 1.8 + Math.pow(random(), .7) * 24;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius, size = .16 + random() * .46;
    transform.position.set(x, groundHeight(x, z) + .012, z);
    transform.rotation.set((random() - .5) * .16, random() * 6.28, (random() - .5) * .2);
    transform.scale.set(size, size * (.5 + random()), size);
    transform.updateMatrix(); litter.setMatrixAt(i, transform.matrix);
    litter.setColorAt(i, litterColors[Math.floor(random() * litterColors.length)]);
  }
  litter.receiveShadow = true; finish(litter);

  const barkMaterial = keepMaterial(new THREE.MeshStandardNodeMaterial({ roughness: .96 }));
  const bark = rockNoise({ p: positionWorld.mul(vec3(8, .18, 8)) });
  const barkGrain = rockNoise({ p: positionWorld.mul(vec3(42, 2, 42)) });
  barkMaterial.colorNode = mix(new THREE.Color('#24271f'), new THREE.Color('#55503e'), bark).mul(barkGrain.mul(.3).add(.75));
  const barkNormal = reliefNormal({ p: positionWorld, n: normalWorldGeometry, h: bark.mul(.025).add(barkGrain.mul(.005)) });
  barkMaterial.normalNode = cameraViewMatrix.mul(vec4(barkNormal, 0)).xyz.normalize();
  const cylinder = keepGeometry(new THREE.CylinderGeometry(.48, 1, 1, 9, 8));
  cylinder.translate(0, .5, 0);
  const trunkPositions = cylinder.attributes.position;
  for (let i = 0; i < trunkPositions.count; i++) {
    const x = trunkPositions.getX(i), y = trunkPositions.getY(i), z = trunkPositions.getZ(i);
    const radius = 1 + (noise(x * 5, y * 8, z * 5) - .5) * .18;
    trunkPositions.setXYZ(i, x * radius + y * y * .16, y, z * radius);
  }
  cylinder.computeVertexNormals();
  const trunks = makeInstances('Tree trunks', cylinder, barkMaterial, 88);
  const branches = makeInstances('Branches', cylinder, barkMaterial, trunks.count * 12);
  const trees = [], up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  const trunkMatrix = new THREE.Matrix4(), branchBase = new THREE.Vector3();
  for (let i = 0; i < trunks.count; i++) {
    const angle = i * 2.399963 + random() * .5, radius = 17 + Math.pow(random(), .7) * 57;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const width = .65 + random() * 1.3, height = 38 + random() * 43;
    const y = groundHeight(x, z);
    transform.position.set(x, y, z);
    transform.rotation.set((random() - .5) * .13, random() * 6.28, (random() - .5) * .13);
    transform.scale.set(width, height, width); transform.updateMatrix(); trunks.setMatrixAt(i, transform.matrix);
    trunkMatrix.copy(transform.matrix);
    trees.push({ x, y, z, height, width });
    for (let j = 0; j < 12; j++) {
      const angle = random() * Math.PI * 2;
      const t = (3 + j * 2.4 + random() * 2) / height;
      branchBase.set(.16 * t * t, t, 0).applyMatrix4(trunkMatrix);
      transform.position.copy(branchBase);
      direction.set(Math.cos(angle), .4 + random() * .5, Math.sin(angle)).normalize();
      transform.quaternion.setFromUnitVectors(up, direction);
      const thickness = width * (.06 + random() * .14);
      transform.scale.set(thickness, 5 + random() * 10, thickness);
      transform.updateMatrix(); branches.setMatrixAt(i * 12 + j, transform.matrix);
    }
  }
  finish(trunks); finish(branches);
  const crownMaterial = keepMaterial(new THREE.MeshStandardNodeMaterial({ roughness: 1 }));
  const crownNoise = rockNoise({ p: positionWorld.mul(.22).add(9) });
  crownMaterial.colorNode = attribute('forestTint', 'vec3').mul(crownNoise.mul(.68).add(.26));
  // A little diffuse transmission keeps the low canopy's shaded sides green.
  crownMaterial.emissiveNode = crownMaterial.colorNode.mul(.06);
  const crownGeometry = keepGeometry(createCrownGeometry());
  const foliage = makeInstances('Low-poly canopy', crownGeometry, crownMaterial, trunks.count * 6);
  const tint = new THREE.Color();
  for (let i = 0; i < foliage.count; i++) {
    const tree = trees[Math.floor(i / 6)], angle = random() * Math.PI * 2, radius = 3 + random() * 8;
    transform.position.set(tree.x + Math.cos(angle) * radius, tree.y + 11 + (i % 6) * 5 + random() * 4, tree.z + Math.sin(angle) * radius);
    transform.rotation.set((random() - .5) * .4, random() * 6.28, (random() - .5) * .4);
    transform.scale.set(4 + random() * 5, 3 + random() * 4, 4 + random() * 5);
    transform.updateMatrix(); foliage.setMatrixAt(i, transform.matrix);
    foliage.setColorAt(i, tint.setRGB(.75 + random() * .4, .8 + random() * .3, .7 + random() * .4));
  }
  finish(foliage);
  const shrubs = makeInstances('Low-poly understory', crownGeometry, crownMaterial, 300);
  for (let i = 0; i < shrubs.count; i++) {
    const distant = i >= 180;
    const angle = i * 2.399963, radius = distant ? 62 + random() * 15 : 22 + Math.pow(random(), .65) * 40;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const size = distant ? 4 + random() * 4 : 1.2 + random() * 2.4;
    transform.position.set(x, groundHeight(x, z) + size * .75, z);
    transform.rotation.set(0, random() * 6.28, 0);
    transform.scale.set(size, size * 1.5, size);
    transform.updateMatrix(); shrubs.setMatrixAt(i, transform.matrix);
    shrubs.setColorAt(i, tint.setRGB(.65 + random() * .4, .8 + random() * .3, .65 + random() * .4));
  }
  finish(shrubs);
  const foliageMaterial = keepMaterial(new THREE.MeshStandardNodeMaterial({ roughness: .85 }));
  const leafVein = uv().x.sub(.5).abs().smoothstep(.012, .04).oneMinus();
  const leafMottle = rockNoise({ p: positionWorld.mul(5) }).mul(.35).add(.8);
  foliageMaterial.colorNode = mix(new THREE.Color('#3c5626'), new THREE.Color('#718844'), leafVein.mul(.3)).mul(leafMottle);
  foliageMaterial.emissiveNode = foliageMaterial.colorNode.mul(.12);
  const sprayGeometry = keepGeometry(createSprayGeometry());
  const ferns = makeInstances('Understory fronds', sprayGeometry, foliageMaterial, 450);
  for (let i = 0; i < ferns.count; i++) {
    const clump = Math.floor(i / 9), angle = clump * 2.39996;
    const radius = 5 + (noise(clump, 0, 0) * 21);
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    transform.position.set(x, groundHeight(x, z), z);
    transform.rotation.set(-.15 - random() * .6, i * 2.39996, 0);
    transform.scale.setScalar(.7 + random() * .9); transform.updateMatrix(); ferns.setMatrixAt(i, transform.matrix);
  }
  ferns.receiveShadow = true; finish(ferns);
  const twigGeometry = keepGeometry(new THREE.CylinderGeometry(.005, .012, 1, 5));
  const twigs = makeInstances('Fallen twigs', twigGeometry, barkMaterial, 280);
  for (let i = 0; i < twigs.count; i++) {
    const angle = random() * 6.28, radius = 2.2 + random() * 15;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    transform.position.set(x, groundHeight(x, z) + .018, z);
    transform.rotation.set(Math.PI / 2, 0, random() * 6.28);
    transform.scale.setScalar(.3 + random() * 1.3); transform.updateMatrix(); twigs.setMatrixAt(i, transform.matrix);
  }
  twigs.receiveShadow = true; finish(twigs);

  return { group, ground, floorMoss, focusSurfaces: [...outcrops.focusSurfaces, floorMoss.carpet, ground],
    stats: { trees: trunks.count, fallenLeaves: litter.count, crowns: foliage.count, shrubs: shrubs.count, fronds: ferns.count, pebbles: pebbles.count, rocks: outcrops.count, smallRocks: outcrops.smallRocks, floorMossTufts: floorMoss.tufts, outcropMossTufts: outcrops.mossTufts, outcropMossRocks: outcrops.mossRocks },
    dispose() {
      outcrops.dispose();
      floorMoss.dispose();
      instances.forEach(mesh => mesh.dispose()); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
    }
  };
}
