import * as THREE from 'three/webgpu';
import { createTuftGeometry } from './botany.js';
import { createStoneGeometry, colonyAt, surfacePoint, surfaceNormal, STONE_CENTER, STONE_SCALE } from './stone.js';
import { randomSeed, noise } from './random.js';
import { createSporophyteGeometry } from './sporophytes.js';
import { ROCK_LAYOUT, groundedRockHeight, updateRockPose, keepOutsideRocks, distanceToRockSurface } from './floating-rocks.js';
import { createRockReaction } from './rock-reaction.js';
import { groundHeight } from './woodland.js';
import { floorColonyAt } from './floor-moss.js';

const UP = new THREE.Vector3(0, 1, 0);

export async function createGarden(materials, progress) {
  const group = new THREE.Group();
  group.name = 'A floating moss garden and three companion stones';
  const stoneGeometry = createStoneGeometry(), bedGeometry = createStoneGeometry(true);
  const variants = 7, tuftGeometries = [], capsuleGeometries = [];
  for (let i = 0; i < variants; i++) {
    progress(`Growing leaf geometry ${i + 1} / ${variants}…`);
    await new Promise(resolve => setTimeout(resolve, 0));
    tuftGeometries.push(createTuftGeometry(600 + i * 73));
  }
  for (let i = 0; i < 3; i++) capsuleGeometries.push(createSporophyteGeometry(100 + i * 37));
  const geometries = [stoneGeometry, bedGeometry, ...tuftGeometries, ...capsuleGeometries];
  const rocks = [], tufts = [], capsules = [], beds = [], stones = [];
  const stats = { rocks: ROCK_LAYOUT.length, shoots: 0, leaves: 0, triangles: 0, tufts: 0, sporophytes: 0 };
  const direction = new THREE.Vector3(), object = new THREE.Object3D();
  const orientation = new THREE.Quaternion(), spin = new THREE.Quaternion(), tint = new THREE.Color();
  for (const [rockIndex, placement] of ROCK_LAYOUT.entries()) {
    const layout = { ...placement };
    const pivot = new THREE.Group();
    pivot.name = `Floating rock ${rockIndex + 1}`;
    // Sibling bundles share the seven leaf geometries. Local shoot placement
    // stays constant; each changed floating pose invalidates its cached world transforms.
    const bundle = new THREE.BundleGroup();
    bundle.scale.setScalar(layout.scale);
    bundle.position.copy(STONE_CENTER).multiplyScalar(-layout.scale);
    pivot.add(bundle); group.add(pivot);
    const width = layout.width ?? 1;
    const rockGeometry = width !== 1 ? createStoneGeometry(false, 288, 192, width) : stoneGeometry;
    const cushionGeometry = width !== 1 ? createStoneGeometry(true, 288, 192, width) : bedGeometry;
    layout.groundY = groundedRockHeight(rockGeometry, layout, (x, z) => groundHeight(x, z) + floorColonyAt(x, z).height - .004);
    if (width !== 1) geometries.push(rockGeometry, cushionGeometry);
    const stone = new THREE.Mesh(rockGeometry, materials.floatingStone);
    stone.name = 'Weathered floating stone';
    const bed = new THREE.Mesh(cushionGeometry, materials.substrate);
    bed.name = 'Moss cushion substrate'; bed.userData.isMossBed = true;
    stone.castShadow = stone.receiveShadow = bed.castShadow = bed.receiveShadow = true;
    bundle.add(stone, bed); stones.push(stone); beds.push(bed);
    const rock = { pivot, bundle, layout, stone, bed, reaction: createRockReaction(layout.scale) };
    rocks.push(rock);
    updateRockPose(pivot, layout, 0);
    const random = randomSeed(20261105 + rockIndex * 971);
    const buckets = Array.from({ length: variants }, () => []);
    // Keep leaf sizes and root spacing in world units. Smaller stones need
    // proportionally fewer shoots, not four copies of the original million leaves.
    const candidateCount = Math.round(42000 * layout.scale ** 2 * width);
    for (let i = 0; i < candidateCount; i++) {
      const y = 1 - 2 * (i + .5) / candidateCount;
      const r = Math.sqrt(1 - y * y), a = i * 2.399963229728653 + (random() - .5) * .008;
      direction.set(Math.cos(a) * r, y, Math.sin(a) * r);
      if (y < -.12) continue;
      const colony = colonyAt(direction);
      if (colony.coverage < .1 || random() > colony.coverage) continue;
      const jacobian = Math.sqrt((direction.x / (STONE_SCALE.x * width)) ** 2 + (y / STONE_SCALE.y) ** 2 + (direction.z / STONE_SCALE.z) ** 2) * STONE_SCALE.y;
      if (random() > jacobian) continue;
      const point = surfacePoint(direction, true, undefined, width);
      const normal = surfaceNormal(direction, true, width);
      normal.lerp(UP, .23).normalize();
      orientation.setFromUnitVectors(UP, normal);
      spin.setFromAxisAngle(UP, random() * Math.PI * 2);
      object.quaternion.copy(orientation).multiply(spin);
      object.scale.setScalar((.72 + random() * .6) / layout.scale);
      object.position.copy(point).addScaledVector(normal, -.009 / layout.scale);
      object.updateMatrix();
      const shade = .78 + noise(point.x * 4 + 4, point.y * 4, point.z * 4) * .42;
      const hue = noise(point.x * 2.3, point.y * 2.3 + 8, point.z * 2.3);
      buckets[Math.floor(random() * variants)].push({ matrix: object.matrix.clone(), shade, hue });
    }
    for (let i = 0; i < variants; i++) {
      const geometry = tuftGeometries[i], items = buckets[i];
      for (let j = items.length - 1; j > 0; j--) {
        const k = Math.floor(random() * (j + 1));
        [items[j], items[k]] = [items[k], items[j]];
      }
      const mesh = new THREE.InstancedMesh(geometry, materials.moss, items.length);
      items.forEach((item, j) => {
        mesh.setMatrixAt(j, item.matrix);
        const { shade, hue } = item;
        mesh.setColorAt(j, tint.setRGB(shade * (.78 + hue * .45), shade, shade * (.8 + hue * .3)));
      });
      mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = `Rock ${rockIndex + 1} moss ${i + 1}`;
      mesh.userData.capacity = items.length;
      mesh.computeBoundingSphere();
      tufts.push(mesh); bundle.add(mesh);
      stats.tufts += items.length;
      stats.shoots += items.length * geometry.userData.shoots;
      stats.leaves += items.length * geometry.userData.leaves;
      stats.triangles += items.length * geometry.userData.triangles;
    }
    for (let i = 0; i < 3; i++) {
      const items = buckets[i].filter((_, index) => index % 49 === 0);
      const mesh = new THREE.InstancedMesh(capsuleGeometries[i], materials.sporophyte, items.length);
      items.forEach((item, j) => mesh.setMatrixAt(j, item.matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = 'Spore capsules';
      bundle.add(mesh); capsules.push(mesh); stats.sporophytes += items.length;
    }
  }
  let density = 1, showSporophytes = false, poseTime = 0;
  const invalidate = () => { for (const rock of rocks) rock.bundle.needsUpdate = true; };
  group.updateMatrixWorld(true);
  return { group, rocks, stones, beds, tufts, capsules, stats,
    focusSurfaces: [...beds, ...stones],
    update(time) {
      if (time === poseTime) return;
      for (const rock of rocks) {
        updateRockPose(rock.pivot, rock.layout, time);
        rock.reaction.apply(rock.pivot, time);
      }
      invalidate();
      group.updateMatrixWorld(true);
      poseTime = time;
    },
    nudge(surface, point, direction, time) {
      const rock = rocks.find(rock => rock.stone === surface || rock.bed === surface);
      if (!rock) return false;
      rock.reaction.kick(point, direction, rock.pivot.position, time);
      poseTime = NaN;
      return true;
    },
    keepCameraOutside(position) { return keepOutsideRocks(position, rocks); },
    distanceToSurface(position) { return distanceToRockSurface(position, rocks); },
    setSporophytes(value) {
      showSporophytes = value;
      for (const mesh of capsules) mesh.visible = value && density > 0;
      invalidate();
    },
    setDensity(value) {
      density = value;
      for (const mesh of tufts) mesh.count = Math.round(mesh.userData.capacity * value);
      for (const bed of beds) bed.visible = value > 0;
      for (const mesh of capsules) mesh.visible = showSporophytes && value > 0;
      invalidate();
    },
    dispose() {
      for (const mesh of [...tufts, ...capsules]) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
    }
  };
}
