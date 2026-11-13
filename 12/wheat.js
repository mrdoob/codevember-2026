import { BundleGroup, BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, Mesh, PlaneGeometry, MeshBasicNodeMaterial, MeshStandardNodeMaterial, HemisphereLight, AmbientLight, DirectionalLight, Object3D, Vector3 } from 'three/webgpu';
import { Fn, attribute, normalWorld, positionWorld, positionView, cameraPosition, vec3, mix } from 'three/tsl';
import { randomGenerator } from './random.js';
import { sunDirection } from './landscape.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inFarmClearing } from './farm-layout.js';
import { terrainHeight, createFieldTerrain } from './field-terrain.js';
import { createWheatWind, wheatGust } from './wheat-wind.js';
import { CAMERA, GROUND_Y, GROUND_SIZE, WHEAT_INNER_RADIUS, WHEAT_OUTER_RADIUS, WHEAT_SCALE } from './scene-constants.js';

// Keep thin leaves visible from either side with ordinary front-face draws.
// Closed stems and grain heads already have outward-facing surfaces.
function addLeafBackfaces(positions, normals, surface, indices) {
  const copies = new Map(), count = indices.length;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  const backVertex = index => {
    if (copies.has(index)) return copies.get(index);
    const copy = positions.length / 3;
    positions.push(...positions.slice(index * 3, index * 3 + 3));
    normals.push(...normals.slice(index * 3, index * 3 + 3).map(value => -value));
    surface.push(...surface.slice(index * 3, index * 3 + 3));
    copies.set(index, copy); return copy;
  };
  for (let i = 0; i < count; i += 3) {
    let [ia, ib, ic] = indices.slice(i, i + 3);
    if (surface[ia * 3] < 3) continue;
    a.fromArray(positions, ia * 3); b.fromArray(positions, ib * 3); c.fromArray(positions, ic * 3);
    n.fromArray(normals, ib * 3);
    if (b.sub(a).cross(c.sub(a)).dot(n) < 0) {
      [ib, ic] = [ic, ib]; indices[i + 1] = ib; indices[i + 2] = ic;
    }
    indices.push(backVertex(ia), backVertex(ic), backVertex(ib));
  }
}

function wheatGeometry(seed) {
  const random = randomGenerator(seed);
  const positions = [], normals = [], surface = [], indices = [];
  const lean = (random() - .5) * .6;
  const stem = y => new Vector3(lean * ((y / 4) ** 2 + Math.max(0, y - 3) ** 2 * .7), y, .035 * Math.sin(y));
  const vertex = (p, n, part, tone) => {
    const index = positions.length / 3;
    positions.push(p.x, p.y, p.z); normals.push(n.x, n.y, n.z); surface.push(part, tone, Math.max(0, Math.min(1, p.y / 4)));
    return index;
  };
  // A triangular stalk and one continuous, tapered ear. The solid ear keeps
  // its silhouette when projected to just a few pixels or simplified by LOD.
  for (let ring = 0; ring < 3; ring++) {
    const y = [-.18, 1.8, 3.25][ring], center = stem(y);
    for (let side = 0; side < 3; side++) {
      const angle = side * Math.PI * 2 / 3, n = new Vector3(Math.cos(angle), 0, Math.sin(angle));
      vertex(center.clone().addScaledVector(n, .022 - ring * .005), n, 0, .85);
      if (ring > 0) {
        const a = (ring - 1) * 3 + side, b = (ring - 1) * 3 + (side + 1) % 3;
        indices.push(a, a + 3, b, b, a + 3, b + 3);
      }
    }
  }
  // Four sides and four height rings retain the solid ear at 24 triangles
  // instead of 60. A small width correction preserves canopy coverage with
  // the coarser cross section; smooth normals keep the golden highlights.
  const start = positions.length / 3, sides = 4;
  const rings = [[3.08, .035], [3.36, .154], [3.76, .115], [4.1, 0]];
  for (let ring = 0; ring < rings.length; ring++) {
    const [y, width] = rings[ring], center = stem(y);
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2;
      const before = rings[Math.max(0, ring - 1)], after = rings[Math.min(rings.length - 1, ring + 1)];
      const slope = (after[1] - before[1]) / (after[0] - before[0]);
      const n = new Vector3(Math.cos(angle), -slope, Math.sin(angle) / .7).normalize();
      vertex(center.clone().add(new Vector3(Math.cos(angle) * width, 0, Math.sin(angle) * width * .7)), n, 1,
        (ring % 2 ? .92 : .8) + random() * .06);
      if (ring > 0) {
        const a = start + (ring - 1) * sides + side, b = start + (ring - 1) * sides + (side + 1) % sides;
        indices.push(a, a + sides, b);
        if (width > 0) indices.push(b, a + sides, b + sides);
      }
    }
  }
  const base = vertex(stem(rings[0][0]), new Vector3(0, -1, 0), 1, .8);
  for (let side = 0; side < sides; side++) indices.push(base, start + side, start + (side + 1) % sides);
  // Two short flag leaves and four awns; each blade has real back faces.
  const blade = (root, tip, width, part, tone) => {
    const axis = tip.clone().sub(root), side = new Vector3(0, 0, width);
    const n = axis.clone().cross(side).normalize();
    for (const face of [1, -1]) {
      const normal = n.clone().multiplyScalar(face);
      const a = vertex(root.clone().sub(side), normal, part, tone);
      const b = vertex(root.clone().add(side), normal, part, tone);
      const c = vertex(tip, normal, part, tone);
      indices.push(a, face > 0 ? c : b, face > 0 ? b : c);
    }
  };
  for (const direction of [-1, 1]) {
    const root = stem(direction < 0 ? 1.5 : 2.3);
    blade(root, root.clone().add(new Vector3(direction * .48, .38, .1)), .06, 3, .75);
    for (const y of [3.38, 3.78]) {
      const root = stem(y).add(new Vector3(direction * .1, 0, 0));
      blade(root, root.clone().add(new Vector3(direction * .13, .43, 0)), .008, 2, .9);
    }
  }
  const geometry = new BufferGeometry();
  geometry.userData.stemSides = 3;
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('wheatSurface', new Float32BufferAttribute(surface, 3));
  geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function createWheat(scene, fibers) {
  const sunlight = fibers.light;
  const group = new BundleGroup(); group.name = 'Wheat field'; scene.add(group);
  const material = new MeshStandardNodeMaterial({ roughness: .55, metalness: 0 });
  material.positionNode = createWheatWind(fibers.time, fibers.breeze);
  const seed = attribute('wheatSeed', 'vec2');
  const surface = attribute('wheatSurface', 'vec3');
  const grain = surface.x.sub(1).abs().lessThan(.25).toFloat();
  // A canopy-level lighting approximation for the changing exposure of grain
  // as a gust bends it. The same moving front drives geometry and highlights,
  // keeping broad wind waves readable after background defocus.
  const canopyLight = mix(1, wheatGust(positionWorld, fibers.time).mul(.44).add(.76),
    surface.z.smoothstep(.3, .8).mul(fibers.breeze.clamp(0, 1)));
  material.roughnessNode = mix(.58, .37, grain).mul(mix(.9, 1, seed.y));
  material.colorNode = Fn(() => {
    const data = attribute('wheatSurface', 'vec3');
    const shortStraw = data.x.greaterThan(3.5).toFloat();
    // Copper straw and amber grain keep their sunset color in the soft fill.
    const maturity = mix(vec3(.68, .22, .035), vec3(.95, .4, .065), seed.y);
    const stalk = mix(mix(vec3(.65, .58, .5), vec3(1), grain), vec3(1.1, 1.05, .9), shortStraw);
    const height = data.z.clamp(0, 1);
    return maturity.mul(stalk).mul(data.y.clamp(.4, 1)).mul(height.mul(.6).add(.4)).mul(canopyLight);
  })();
  material.emissiveNode = Fn(() => {
    const data = attribute('wheatSurface', 'vec3');
    const n = normalWorld.normalize();
    const sun = vec3(sunDirection);
    const view = cameraPosition.sub(positionWorld).normalize();
    const back = n.dot(sun).negate().max(0);
    const awn = data.x.sub(2).abs().lessThan(.25).toFloat();
    const grain = data.x.sub(1).abs().lessThan(.25).toFloat();
    const forward = view.dot(sun.negate()).max(0).pow(5);
    const transmitted = vec3(1.55, .48, .055).mul(back.mul(.5).add(.08)).mul(forward).mul(awn.mul(.7).add(.85)).mul(sunlight);
    const edge = n.dot(view).abs().oneMinus().pow(3);
    const rim = vec3(1.1, .34, .035).mul(edge).mul(grain.mul(.35).add(.08)).mul(sunlight);
    const shade = data.z.clamp(0, 1).mul(.65).add(.35);
    const maturity = mix(vec3(.75, .57, .35), vec3(1, .95, .65), seed.y);
    const lit = transmitted.add(rim).mul(data.y.clamp(.4, 1)).mul(shade).mul(maturity);
    const haze = positionView.z.negate().sub(22).max(0).mul(.009).clamp(0, .32);
    return mix(lit, vec3(.72, .26, .045), haze).mul(canopyLight);
  })();
  const random = randomGenerator(121126), batches = [], dummy = new Object3D();
  const stalks = Array.from({ length: 3 }, (_, i) => wheatGeometry(120 + i * 43));
  const patches = new Map();
  function patchGeometry(side, spacing, slopeX, slopeZ, count) {
    const key = `${side}/${count}/${slopeX}/${slopeZ}`;
    if (patches.has(key)) return patches.get(key);
    const parts = [], roots = [], plant = new Object3D();
    const rng = randomGenerator(520 + side * 91 + Math.round((slopeX + 8) * 1321 + (slopeZ + 8) * 157));
    // Shuffle the thinning order instead of retaining a repeating diagonal
    // stride through the grid. The full nearby patches still keep every stalk.
    const order = Array.from({ length: side * side }, (_, j) => j);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const retained = new Set(order.slice(0, count));
    for (let i = 0; i < side * side; i++) {
      const x = (i % side - (side - 1) / 2 + (rng() - .5) * .95) * spacing;
      const z = (Math.floor(i / side) - (side - 1) / 2 + (rng() - .5) * .95) * spacing;
      plant.position.set(x, slopeX * x + slopeZ * z, z);
      plant.rotation.set((rng() - .5) * .22, rng() * Math.PI * 2, (rng() - .5) * .35);
      plant.scale.set(.8 + rng() * .4, .94 + rng() * .4, .8 + rng() * .4).multiplyScalar(WHEAT_SCALE);
      plant.updateMatrix();
      if (!retained.has(i)) continue;
      const geometry = stalks[i % stalks.length].clone(); geometry.applyMatrix4(plant.matrix); parts.push(geometry);
      roots.push(new Vector3(0, -.18, 0).applyMatrix4(plant.matrix));
    }
    const geometry = mergeGeometries(parts); parts.forEach(part => part.dispose());
    geometry.userData.stemSides = 3;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const patch = { geometry, roots, count, near: side === 4, items: [] };
    patches.set(key, patch); return patch;
  }
  const fieldRadius = 60;
  // Small patches fill the nearby field; larger patches cover distant areas.
  // Quantized slopes are baked into the geometry. Instance transforms
  // stay fixed while the vertex shader bends the stalks above their roots.
  for (const [side, spacing, inner, outer] of [[4, .11, 0, 26], [8, .16, 26, fieldRadius]]) {
    const tile = side * spacing;
    for (let cellX = -outer; cellX <= outer; cellX += tile) for (let cellZ = -outer; cellZ <= outer; cellZ += tile) {
      // Break alignment between reusable patches without opening large gaps.
      const x = cellX + (random() - .5) * tile * .35;
      const z = cellZ + (random() - .5) * tile * .35;
      const radius = Math.hypot(x, z);
      if (radius < inner || radius >= outer || inFarmClearing(x, z, false, tile * .7 + .15)) continue;
      const step = .2, quantum = side === 4 ? .5 : .125;
      const dx = (terrainHeight(x + step, z) - terrainHeight(x - step, z)) / (step * 2);
      const dz = (terrainHeight(x, z + step) - terrainHeight(x, z - step)) / (step * 2);
      const angle = random() * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
      const slopeX = Math.round((dx * c - dz * s) / quantum) * quantum;
      const slopeZ = Math.round((dx * s + dz * c) / quantum) * quantum;
      // Fill the center and nearby field, then smoothly reduce the distant canopy to
      // one quarter density. Dither neighboring patch counts instead of making
      // visible rings or changing instances as the camera moves.
      const t = Math.max(0, Math.min(1, (radius - 26) / 30));
      const density = 1 - .75 * t * t * (3 - 2 * t);
      const level = side === 4 ? 1 : density * 4;
      const count = side === 4 ? 16 : 16 * (Math.floor(level) + (random() < level % 1 ? 1 : 0));
      const patch = patchGeometry(side, spacing, slopeX, slopeZ, count);
      let y = terrainHeight(x, z) - .025;
      // Lower the patch just enough for every root to touch its actual soil.
      let gap = 0;
      for (const root of patch.roots) {
        gap = Math.max(gap, y + root.y - terrainHeight(x + root.x * c + root.z * s, z - root.x * s + root.z * c) + .02);
      }
      y -= gap;
      dummy.position.set(x, y, z); dummy.rotation.set(0, angle, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
      patch.items.push({ matrix: dummy.matrix.clone(), tone: .35 + random() * .3 });
    }
  }
  for (const [key, patch] of patches) {
    const { geometry, items } = patch;
    if (!items.length) { geometry.dispose(); continue; }
    const mesh = new InstancedMesh(geometry, material, items.length), seeds = new Float32Array(items.length * 2);
    mesh.name = `Wheat / ${patch.near ? 'bank' : 'field'} ${key}`;
    mesh.userData.isWheat = true; mesh.userData.stalksPerInstance = patch.count;
    mesh.userData.stalkRoots = patch.roots;
    mesh.frustumCulled = false;
    items.forEach((item, index) => { mesh.setMatrixAt(index, item.matrix); seeds[index * 2 + 1] = item.tone; });
    geometry.setAttribute('wheatSeed', new InstancedBufferAttribute(seeds, 2));
    group.add(mesh); batches.push(mesh);
  }
  stalks.forEach(geometry => geometry.dispose());
  // Short ground cover grows from the same soil as the crops and landmarks.
  const grassPositions = [], grassNormals = [], grassSurface = [], grassIndices = [];
  for (let blade = 0; blade < 3; blade++) {
    const angle = random() * Math.PI * 2, height = .16 + random() * .16, bend = .06 + random() * .09;
    const start = grassPositions.length / 3, width = .006 + random() * .005;
    for (let j = 0; j <= 2; j++) {
      const u = j / 2, radius = bend * u * u;
      const w = width * Math.sin(Math.PI * u) ** .7;
      for (const side of [-1, 1]) {
        grassPositions.push(Math.sin(angle) * radius + Math.cos(angle) * w * side, height * (u - .12 * u ** 3), Math.cos(angle) * radius - Math.sin(angle) * w * side);
        grassNormals.push(Math.sin(angle), -.25 * u, Math.cos(angle));
        grassSurface.push(4, .7 + blade * .03, height * (u - .12 * u ** 3) / .7);
      }
      // Root and tip collapse to points. Keep only the non-degenerate half
      // of each quad: the same blade silhouette with half the triangles.
      const i = start + j * 2;
      if (j === 0) grassIndices.push(i + 1, i + 3, i + 2);
      else if (j === 1) grassIndices.push(i, i + 1, i + 2);
    }
  }
  addLeafBackfaces(grassPositions, grassNormals, grassSurface, grassIndices);
  const grassGeometry = new BufferGeometry();
  grassGeometry.setAttribute('position', new Float32BufferAttribute(grassPositions, 3));
  grassGeometry.setAttribute('normal', new Float32BufferAttribute(grassNormals, 3));
  grassGeometry.setAttribute('wheatSurface', new Float32BufferAttribute(grassSurface, 3));
  grassGeometry.setIndex(grassIndices);
  const bankTufts = 6000;
  const grass = new InstancedMesh(grassGeometry, material, 2000 + bankTufts);
  grass.name = 'Field / short straw';
  const grassSeeds = new Float32Array(grass.count * 2);
  for (let i = 0; i < grass.count; i++) {
    let angle = random() * Math.PI * 2;
    // Overlap short straw with the nearby and outer crop patches.
    const radius = i < 4000 ? 6 + Math.sqrt(random()) * 15
      : i < bankTufts ? 14 + Math.sqrt(random()) * 16
      : WHEAT_INNER_RADIUS + Math.sqrt(random()) * (WHEAT_OUTER_RADIUS - WHEAT_INNER_RADIUS);
    let x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
    while (inFarmClearing(x, z, true)) {
      angle += 2.399963229728653;
      x = Math.sin(angle) * radius; z = Math.cos(angle) * radius;
    }
    dummy.position.set(x, terrainHeight(x, z) - .05, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.scale.setScalar(.85 + random() * .35);
    dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix);
    grassSeeds[i * 2] = random() * Math.PI * 2; grassSeeds[i * 2 + 1] = random();
  }
  grassGeometry.setAttribute('wheatSeed', new InstancedBufferAttribute(grassSeeds, 2));
  grass.frustumCulled = false;
  group.add(grass); batches.push(grass);
  const terrain = createFieldTerrain(scene);
  const groundMaterial = new MeshBasicNodeMaterial();
  const mottling = positionWorld.x.mul(.73).sin().mul(positionWorld.z.mul(.91).sin()).mul(.2).add(.8);
  const soil = vec3(.075, .046, .021).mul(mottling);
  const groundHaze = positionView.z.negate().sub(16).max(0).mul(.015).clamp(0, .75);
  const groundColor = mix(soil, vec3(.44, .25, .11), groundHaze);
  // Match the world-space landscape before the floor reaches a mesh edge or
  // the camera's far plane. Radial distance also covers wide-screen corners.
  const horizon = cameraPosition.sub(positionWorld).length().smoothstep(CAMERA.far * .6, CAMERA.far * .85);
  groundMaterial.colorNode = mix(groundColor, scene.backgroundNode, horizon);
  const ground = new Mesh(new PlaneGeometry(GROUND_SIZE, GROUND_SIZE), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y, 0);
  scene.add(ground);
  const sky = new HemisphereLight('#d5e0ec', '#75502a', .9);
  const fill = new AmbientLight('#c6d2e1', .65);
  const sun = new DirectionalLight('#ffdda5', 3.2);
  sun.position.copy(sunDirection).multiplyScalar(80);
  sun.target.position.set(0, 0, 0);
  scene.add(sky, fill, sun, sun.target);
  return {
    batches, group, material, ground, terrain, sun, sky, fill,
    dispose() { for (const mesh of batches) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.dispose(); } group.removeFromParent(); material.dispose(); terrain.dispose(); ground.removeFromParent(); ground.geometry.dispose(); groundMaterial.dispose(); sky.removeFromParent(); fill.removeFromParent(); sun.removeFromParent(); sun.target.removeFromParent(); },
  };
}
