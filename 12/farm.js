import { Group, Mesh, MeshStandardNodeMaterial, BoxGeometry, CylinderGeometry, SphereGeometry, IcosahedronGeometry, TorusGeometry, BufferGeometry, Float32BufferAttribute, Vector3, Matrix4, Quaternion, Box3 } from 'three/webgpu';
import { color, mix, positionGeometry, positionWorld, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FARM_SITES } from './farm-layout.js';
import { randomGenerator } from './random.js';
import { terrainHeight } from './field-terrain.js';
import { createTreeWind, TREE_WIND_STRENGTH } from './tree-wind.js';

// These landmarks are read through the lens: broad silhouettes and a few
// recognizable details, with geometry merged by material for each small site.
export function createFarm(scene, fibers) {
  const root = new Group(); root.name = 'Around the wheat field';
  const materials = [], originals = new Set(), landmarks = [], records = new WeakMap();
  const material = (tint, roughness = .8, metalness = 0) => {
    const result = new MeshStandardNodeMaterial({ color: tint, roughness, metalness });
    materials.push(result); return result;
  };
  const plaster = material('#d5b48b'), wood = material('#55432d'), roof = material('#773a24');
  const dark = material('#262b24'), paint = material('#a6361c', .43, .15);
  const metal = material('#b8ad8d', .45, .3), straw = material('#b98036');
  const foliage = material('#4b472f');
  // Bronze outer leaves and cooler, darker pockets retain a readable oak
  // silhouette against the pale sky and warm sunset.
  foliage.colorNode = mix(color('#30382b'), color('#76603b'),
    positionWorld.x.mul(2.7).add(positionWorld.z.mul(3.9)).sin().mul(positionWorld.y.mul(3).sin()).mul(.5).add(.5))
    .mul(positionGeometry.y.smoothstep(3, 12).mul(.3).add(.72));
  const box = new BoxGeometry(), cylinder = new CylinderGeometry(1, 1, 1, 12);
  const branchShape = new CylinderGeometry(.5, 1, 1, 7);
  const crown = new IcosahedronGeometry(1, 0), sphere = new SphereGeometry(1, 12, 8);
  const tire = new TorusGeometry(.76, .24, 8, 24), steering = new TorusGeometry(.28, .04, 5, 12);
  function add(parent, geometry, surface, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
    originals.add(geometry);
    const mesh = new Mesh(geometry, surface);
    mesh.position.fromArray(position); mesh.scale.fromArray(scale); mesh.rotation.fromArray(rotation);
    parent.add(mesh); return mesh;
  }
  function beam(parent, a, b, radius, surface = wood) {
    const from = new Vector3(...a), to = new Vector3(...b), delta = to.clone().sub(from);
    const mesh = add(parent, cylinder, surface, from.add(to).multiplyScalar(.5).toArray(), [radius, delta.length(), radius]);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
  }
  function bake(group) {
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert(), buckets = new Map(), meshes = [];
    group.traverse(object => { if (object.isMesh) meshes.push(object); });
    for (const mesh of meshes) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geometry.deleteAttribute('uv');
      geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
      if (!buckets.has(mesh.material)) buckets.set(mesh.material, []);
      buckets.get(mesh.material).push(geometry);
    }
    group.clear();
    for (const [surface, parts] of buckets) {
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      if (surface.positionNode) {
        const padding = 3 * TREE_WIND_STRENGTH;
        geometry.boundingBox.expandByScalar(padding); geometry.boundingSphere.radius += padding;
      }
      const mesh = new Mesh(geometry, surface);
      group.add(mesh);
    }
  }
  function object(parent, name, position, scale = 1, yaw = 0) {
    const group = new Group(); group.name = name; group.position.fromArray(position);
    group.scale.setScalar(scale); group.rotation.y = yaw; parent.add(group);
    group.updateWorldMatrix(true, false);
    const world = group.getWorldPosition(new Vector3());
    group.position.y = terrainHeight(world.x, world.z);
    const record = { name, object: group, contacts: [] };
    landmarks.push(record); records.set(group, record); return group;
  }
  function contact(group, mesh, point, kind = 'embedded') {
    records.get(group).contacts.push({ mesh, point: new Vector3(...point), kind });
  }
  function localGround(group, x, z) {
    group.updateWorldMatrix(true, false);
    const point = new Vector3(x, 0, z).applyMatrix4(group.matrixWorld);
    point.y = terrainHeight(point.x, point.z);
    return group.worldToLocal(point).y;
  }
  function levelFloor(group, footprint) {
    group.updateWorldMatrix(true, false);
    const elevations = footprint.map(([x, z]) => {
      const point = new Vector3(x, 0, z).applyMatrix4(group.matrixWorld);
      return terrainHeight(point.x, point.z);
    });
    // A level floor sits just above the highest corner. Its footing reaches
    // below the lowest one, so no edge can hang above sloping soil.
    group.position.y = Math.max(...elevations) + .06;
    return (Math.min(...elevations) - .2 - group.position.y) / group.scale.y;
  }
  function followSlope(group, supports) {
    const parent = group.parent;
    parent.updateWorldMatrix(true, false);
    const height = (x, z) => {
      const point = new Vector3(x, 0, z).applyMatrix4(parent.matrixWorld);
      return terrainHeight(point.x, point.z);
    };
    const { x, z } = group.position;
    const normal = new Vector3(height(x - .5, z) - height(x + .5, z), 1,
      height(x, z - .5) - height(x, z + .5)).normalize();
    group.quaternion.premultiply(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal));
    group.updateWorldMatrix(true, true);
    let highestGap = -Infinity;
    for (const point of supports) {
      const world = new Vector3(...point).applyMatrix4(group.matrixWorld);
      highestGap = Math.max(highestGap, world.y - terrainHeight(world.x, world.z));
    }
    group.position.y -= highestGap + .015;
  }
  function building(parent, name, position, scale, barn = false, yaw = 0) {
    const group = object(parent, name, position, scale, yaw);
    const bottom = levelFloor(group, [[-3.025, -2.225], [3.025, -2.225], [-3.025, 2.225], [3.025, 2.225]]);
    add(group, box, barn ? paint : plaster, [0, 1.5, 0], [6, 3, 4.4]);
    const footing = add(group, box, wood, [0, (bottom + .02) / 2, 0], [6.05, .02 - bottom, 4.45]);
    for (const x of [-.5, .5]) for (const z of [-.5, .5]) contact(group, footing, [x, -.5, z]);
    const gable = new BufferGeometry();
    gable.setAttribute('position', new Float32BufferAttribute([
      -3, 3, -2.2, 0, 4.6, -2.2, 3, 3, -2.2,
      3, 3, 2.2, 0, 4.6, 2.2, -3, 3, 2.2,
    ], 3)); gable.computeVertexNormals(); add(group, gable, barn ? paint : plaster);
    for (const side of [-1, 1]) {
      add(group, box, roof, [side * 1.6, 3.77, 0], [3.75, .18, 5.15], [0, 0, -side * .49]);
      if (!barn) {
        add(group, box, dark, [side * 1.9, 1.9, -2.24], [1.05, 1.2, .1]);
        add(group, box, plaster, [side * 1.9, 1.9, -2.32], [.08, 1.2, .08]);
      }
    }
    add(group, box, dark, [0, barn ? 1.25 : 1, -2.26], [barn ? 2.5 : .9, barn ? 2.5 : 2, .13]);
    if (barn) {
      for (const side of [-1, 1]) beam(group, [side * 1.2, .1, -2.36], [-side * 1.2, 2.4, -2.36], .055, plaster);
    } else {
      add(group, box, roof, [-1.1, 4.55, .65], [.55, 1.6, .65]);
      add(group, box, roof, [0, 2.5, -2.9], [2.5, .15, 1.7], [.1, 0, 0]);
      for (const side of [-1, 1]) {
        const lower = localGround(group, side * 1.1, -3.6) - .15;
        const post = add(group, box, wood, [side * 1.1, (lower + 2.4) / 2, -3.6], [.13, 2.4 - lower, .13]);
        contact(group, post, [0, -.5, 0]);
      }
    }
    return group;
  }
  function tree(parent, position, scale = 1, seed = 42) {
    const group = object(parent, 'Field tree', position, scale), random = randomGenerator(seed);
    group.updateWorldMatrix(true, false);
    const origin = group.getWorldPosition(new Vector3());
    const direction = new Vector3(.92, 0, .39).transformDirection(group.matrixWorld.clone().invert());
    group.userData.treeWind = { origin, direction };
    const rootNode = uniform(origin), directionNode = uniform(direction);
    const bark = wood.clone(), leaves = foliage.clone();
    bark.name = 'Wind-blown tree branches'; leaves.name = 'Wind-blown tree foliage';
    bark.positionNode = createTreeWind(rootNode, directionNode, fibers.time, fibers.breeze, 0);
    leaves.positionNode = createTreeWind(rootNode, directionNode, fibers.time, fibers.breeze, 1);
    materials.push(bark, leaves);
    const branch = (a, b, radius) => {
      const from = new Vector3(...a), to = new Vector3(...b), delta = to.clone().sub(from);
      const mesh = add(group, branchShape, bark, from.add(to).multiplyScalar(.5).toArray(), [radius, delta.length(), radius]);
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
      return mesh;
    };
    const trunk = branch([0, -.2, 0], [.18, 2.9, .1], .56);
    contact(group, trunk, [0, -.5, 0]);
    branch([.18, 2.9, .1], [-.3, 5.4, .2], .34);
    const tuft = (x, y, z, size = 1) => add(group, crown, leaves, [x, y, z],
      [(.65 + random() * .35) * size, (.55 + random() * .4) * size, (.65 + random() * .35) * size],
      [random(), random(), random()]);
    // Low forks carry a spreading crown. Small overlapping tufts make a
    // broken, irregular perimeter rather than a few large rounded lobes.
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.399963229728653, radius = 2.6 + random() * 1.1;
      const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
      const y = 5.6 + random() * 1.3;
      const fork = [x * .45, 3.6 + random() * .9, z * .45];
      branch([.05, 2.7 + random() * .8, 0], fork, .22);
      branch(fork, [x, y + .1, z], .13);
      for (let j = 0; j < 7; j++) {
        tuft(x + (random() - .5) * 1.9, y + (random() - .5) * 1.6, z + (random() - .5) * 1.9);
      }
    }
    // An uneven dome fills the center without closing every branch opening.
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.399963229728653, radius = Math.sqrt(random()) * 2.35;
      tuft(Math.sin(angle) * radius, 7.1 + random() * 1.25, Math.cos(angle) * radius, 1.05);
    }
    return group;
  }
  function tractor(parent) {
    const group = object(parent, 'Red tractor', [3.5, 0, -6], 1.3, -.65);
    followSlope(group, [[-1.1, 0, 1], [1.1, 0, 1], [-.9, 0, -1.55], [.9, 0, -1.55]]);
    add(group, box, dark, [0, .9, -.2], [1, .25, 3.9]);
    add(group, box, paint, [0, 1.6, -.9], [1.2, 1.1, 2.25]);
    add(group, box, dark, [0, 1.6, -2.05], [1, .8, .08]);
    for (let i = 0; i < 5; i++) add(group, box, metal, [-.4 + i * .2, 1.6, -2.11], [.04, .65, .05]);
    add(group, box, dark, [0, 1.8, .9], [.7, .18, .65]);
    add(group, box, dark, [0, 2, 1.2], [.7, .5, .15]);
    add(group, cylinder, dark, [.4, 2.65, -1.2], [.085, 1.6, .085]);
    beam(group, [0, 1.1, .1], [0, 2.15, .35], .04, metal);
    add(group, steering, dark, [0, 2.2, .35], [1, 1, 1], [.85, 0, 0]);
    for (const side of [-1, 1]) {
      add(group, sphere, metal, [side * .65, 1.9, -2], [.13, .13, .12]);
      add(group, box, paint, [side * 1.05, 2.2, 1], [.65, .12, 1.8]);
      for (const rear of [true, false]) {
        const r = rear ? 1.1 : .67, x = side * (rear ? 1.1 : .9), z = rear ? 1 : -1.55;
        const wheel = add(group, tire, dark, [x, r, z], [r, r, r], [0, Math.PI / 2, 0]);
        contact(group, wheel, [0, -1, 0], 'resting');
        add(group, cylinder, metal, [x, r, z], [r * .46, r * .6, r * .46], [0, 0, Math.PI / 2]);
      }
    }
    return group;
  }
  function bales(parent, position) {
    const group = object(parent, 'Hay bales', position);
    followSlope(group, [[-1.1, 0, 0], [1.1, 0, .2]]);
    for (const [x, y, z] of [[-1.1, 1, 0], [1.1, 1, .2], [0, 1 + Math.sqrt(4 - 1.1 ** 2 - .1 ** 2), .1]]) {
      const bale = add(group, cylinder, straw, [x, y, z], [1, 1.7, 1], [Math.PI / 2, 0, 0]);
      if (y === 1) contact(group, bale, [0, 0, 1], 'resting');
      for (const offset of [-.57, .57]) add(group, new TorusGeometry(1.01, .035, 4, 16), wood, [x, y, z + offset]);
    }
  }
  function fence(parent, position) {
    const group = object(parent, 'Timber fence', position);
    let previous;
    for (let i = 0; i < 6; i++) {
      const x = -5 + i * 2, ground = localGround(group, x, 0);
      const post = add(group, box, wood, [x, ground + .8, 0], [.16, 2, .16]);
      contact(group, post, [0, -.5, 0]);
      if (previous) for (const y of [.5, 1.3]) beam(group, [previous.x, previous.ground + y, 0], [x, ground + y, 0], .07);
      previous = { x, ground };
    }
  }
  for (const site of FARM_SITES) {
    const group = new Group(); group.name = site.name;
    group.position.set(site.x, 0, site.z); group.rotation.y = site.angle; root.add(group);
    if (site.kind === 'farm') {
      building(group, 'Farmhouse', [-5, 0, 1], 1.45, false, .31);
      tree(group, [10.5, 0, 2], 1.15, 14); tractor(group); fence(group, [-5, 0, -6]);
    } else if (site.kind === 'barn') {
      building(group, 'Red barn', [-2, 0, 0], 1.25, true, -.36);
      const silo = object(group, 'Grain silo', [5.5, 0, 1]);
      const bottom = levelFloor(silo, [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]);
      const footing = add(silo, cylinder, wood, [0, bottom / 2, 0], [1.6, -bottom, 1.6]);
      for (const [x, z] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) contact(silo, footing, [x, -.5, z]);
      add(silo, cylinder, metal, [0, 3.1, 0], [1.45, 6.2, 1.45]);
      add(silo, new CylinderGeometry(0, 1.65, 1.2, 12), roof, [0, 6.8, 0]);
      bales(group, [0, 0, -5]);
    } else if (site.kind === 'shed') {
      building(group, 'Timber shed', [-2, 0, 1], 1, true, .24);
      tree(group, [6, 0, 2], .85, 91); bales(group, [-1, 0, -5]);
    } else {
      tree(group, [0, 0, 0], site.scale, site.seed);
      if (site.kind === 'grove') tree(group, [5, 0, 2], site.scale * .7, site.seed + 1);
    }
    // Keep metadata for framing checks after merging the actual draw geometry.
    group.updateMatrixWorld(true);
    for (const landmark of landmarks) if (landmark.object?.parent) {
      landmark.position = landmark.object.getWorldPosition(new Vector3());
      landmark.bounds = new Box3().setFromObject(landmark.object);
      landmark.contacts = landmark.contacts.map(({ mesh, point, kind }) => ({ point: mesh.localToWorld(point), kind }));
      landmark.object = null;
    }
    // Keep each tree in its own rooted frame. Houses and fences stay static;
    // trunks and crowns share a continuous deformation without CPU updates.
    const trees = group.children.filter(child => child.userData.treeWind);
    for (const tree of trees) { bake(tree); tree.removeFromParent(); }
    bake(group);
    for (const tree of trees) group.add(tree);
  }
  for (const geometry of originals) geometry.dispose();
  scene.add(root);
  return {
    root, landmarks,
    dispose() {
      root.removeFromParent(); root.traverse(object => { if (object.isMesh) object.geometry.dispose(); });
      for (const surface of materials) surface.dispose();
    },
  };
}
