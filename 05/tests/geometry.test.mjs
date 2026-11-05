import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Plane, Matrix4, MeshStandardNodeMaterial, Raycaster } from 'three/webgpu';
import { createTuftGeometry } from '../botany.js';
import { createStoneGeometry, colonyAt, surfacePoint, surfaceNormal, rockRadius, STONE_CENTER } from '../stone.js';
import { createWoodland, groundHeight, createTerrainGeometry } from '../woodland.js';
import { createFloorMoss } from '../floor-moss.js';
import { ready, createMeshlets, MESHLET_SIZE } from 'three/addons/utils/MeshletGeometryUtils.js';

test('all seven moss variants have closed, consistently wound shells and finite normals', () => {
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let variant = 0; variant < 7; variant++) {
    const geometry = createTuftGeometry(600 + variant * 73);
    const p = geometry.attributes.position, n = geometry.attributes.normal, indices = geometry.index.array;
    const edges = new Map();
    let volume = 0;
    for (let i = 0; i < p.count; i++) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(n, i);
      assert.ok(a.toArray().every(Number.isFinite));
      assert.ok(Math.abs(b.length() - 1) < 1e-5);
      assert.ok(geometry.boundingSphere.containsPoint(a));
      assert.ok(a.y >= 0, 'No geometry below the shoot root');
    }
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = [indices[i], indices[i + 1], indices[i + 2]];
      a.fromBufferAttribute(p, triangle[0]); b.fromBufferAttribute(p, triangle[1]); c.fromBufferAttribute(p, triangle[2]);
      volume += a.dot(b.clone().cross(c)) / 6;
      assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() > 1e-25, 'No zero-area triangles');
      for (let k = 0; k < 3; k++) {
        const x = triangle[k], y = triangle[(k + 1) % 3];
        const key = x < y ? `${x},${y}` : `${y},${x}`;
        const edge = edges.get(key) || [0, 0];
        edge[0]++; edge[1] += x < y ? 1 : -1;
        edges.set(key, edge);
      }
    }
    for (const [count, winding] of edges.values()) {
      assert.equal(count, 2, 'Exactly two triangles meet at every edge');
      assert.equal(winding, 0, 'Adjacent triangle winding agrees');
    }
    assert.ok(volume > 0, 'Positive volume gives outward faces');
    geometry.dispose();
  }
});

test('botanical geometry is reproducible and variants differ', () => {
  const a = createTuftGeometry(600), b = createTuftGeometry(600), c = createTuftGeometry(673);
  assert.deepEqual(a.attributes.position.array, b.attributes.position.array);
  assert.deepEqual(a.index.array, b.index.array);
  assert.notDeepEqual(a.attributes.position.array, c.attributes.position.array);
  assert.equal(a.userData.shoots, 7);
  assert.ok(a.userData.leaves > 100);
  for (const g of [a, b, c]) g.dispose();
});

test('colonies are continuous around the sphere, stay above the rock, and have finite surface frames', () => {
  for (let i = 0; i < 1000; i++) {
    const y = 1 - 2 * (i + .5) / 1000, r = Math.sqrt(1 - y * y), angle = i * 2.399963;
    const d = new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
    const colony = colonyAt(d), rock = surfacePoint(d), bed = surfacePoint(d, true), normal = surfaceNormal(d, true);
    assert.ok(colony.coverage >= 0 && colony.coverage <= 1);
    assert.ok(colony.height >= 0 && colony.height <= .26);
    assert.ok(bed.distanceTo(STONE_CENTER) >= rock.distanceTo(STONE_CENTER) - 1e-9);
    assert.ok(normal.toArray().every(Number.isFinite));
    assert.ok(Math.abs(normal.length() - 1) < 1e-8);
    assert.ok(normal.dot(d) > 0, 'Normals point away from the rock');
    const nearby = d.clone().add(new Vector3(1e-6, 0, 0)).normalize();
    assert.ok(Math.abs(colony.height - colonyAt(nearby).height) < .001);
  }
});

test('stone intersects the forest floor and substrate only covers colony sites', () => {
  const stone = createStoneGeometry(false, 120, 80), bed = createStoneGeometry(true, 120, 80);
  stone.computeBoundingBox();
  assert.ok(stone.boundingBox.min.y < -.28, 'Stone is embedded, not floating');
  assert.ok(bed.index.count > 0 && bed.index.count < stone.index.count * .7);
  for (const geometry of [stone, bed]) {
    for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
    geometry.dispose();
  }
});

test('the real r187 meshlet builder preserves full-detail leaf triangles and custom shading attributes', async () => {
  await ready;
  const geometry = createTuftGeometry(600);
  const meshlets = createMeshlets(geometry);
  assert.equal(meshlets.lodCount, 6);
  assert.equal(meshlets.hasAttribute('pigment'), true);
  assert.equal(meshlets.hasAttribute('plant'), true);
  assert.ok(meshlets.chunkArray.every(Number.isFinite));
  const first = meshlets.lodOffsetValues[0];
  let actual = 0;
  for (let i = first.x * 3; i < (first.x + first.y) * 3; i += 3) {
    const [a, b, c] = meshlets.indexArray.subarray(i, i + 3);
    if (a !== b && b !== c && c !== a) actual++;
  }
  assert.equal(actual, geometry.index.count / 3, 'LOD 0 retains every triangle');
  for (let i = 0; i < meshlets.lodCount; i++) {
    const level = meshlets.lodOffsetValues[i];
    assert.equal(level.y % MESHLET_SIZE, 0);
    if (i > 0) assert.ok(level.w >= meshlets.lodOffsetValues[i - 1].w);
  }
  assert.ok(meshlets.lodOffsetValues.at(-1).y < first.y / 4);
  geometry.dispose();
});

test('the rock has broad planar fractures rather than a spherical base', () => {
  const points = [[-.3, -.25, 1], [.3, -.25, 1], [-.3, .25, 1], [.1, .1, 1]].map(values => {
    const direction = new Vector3(...values).normalize();
    return direction.multiplyScalar(rockRadius(direction));
  });
  const plane = new Plane().setFromCoplanarPoints(...points.slice(0, 3));
  assert.ok(Math.abs(plane.distanceToPoint(points[3])) < 1e-4);
  const radii = [];
  for (let i = 0; i < 200; i++) {
    const y = 1 - (i + .5) / 100, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    radii.push(rockRadius(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r)));
  }
  assert.ok(Math.max(...radii) - Math.min(...radii) > .2, 'Broken facets vary the radial silhouette');
});

test('procedural terrain has finite upward normals and keeps the subject on soil', () => {
  const geometry = createTerrainGeometry();
  const normals = geometry.attributes.normal;
  assert.ok(geometry.attributes.position.array.every(Number.isFinite));
  for (let i = 0; i < normals.count; i++) {
    const n = new Vector3().fromBufferAttribute(normals, i);
    assert.ok(n.toArray().every(Number.isFinite) && n.y > 0);
    assert.ok(Math.abs(n.length() - 1) < 1e-5);
  }
  const rock = createStoneGeometry(false, 72, 48);
  let embedded = 0;
  for (let i = 0; i < rock.attributes.position.count; i++) {
    const p = new Vector3().fromBufferAttribute(rock.attributes.position, i);
    if (p.y < groundHeight(p.x, p.z)) embedded++;
  }
  assert.ok(embedded > 0, 'Rock penetrates the supporting ground');
  assert.ok(embedded < rock.attributes.position.count / 3, 'Most of the rock remains exposed');
  geometry.dispose(); rock.dispose();
});

test('the woodland needs no image maps and trees and surrounding rocks meet the terrain', () => {
  const material = new MeshStandardNodeMaterial(), woodland = createWoodland(material);
  const matrix = new Matrix4(), position = new Vector3();
  const trunks = woodland.group.getObjectByName('Tree trunks');
  for (let i = 0; i < trunks.count; i++) {
    trunks.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
    assert.ok(Math.abs(position.y - groundHeight(position.x, position.z)) < 1e-5);
  }
  woodland.group.traverse(object => {
    if (!object.isMesh) return;
    assert.ok(object.geometry.attributes.position.array.every(Number.isFinite));
    assert.equal(object.material.map, null);
    assert.equal(object.material.normalMap, null);
    assert.equal(object.material.roughnessMap, null);
    if (object.isInstancedMesh) assert.ok(object.instanceMatrix.array.every(Number.isFinite));
    if (!object.name.startsWith('Surrounding rocks')) return;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix);
      let below = false, above = false;
      const positions = object.geometry.attributes.position;
      for (let j = 0; j < positions.count; j += 3) {
        position.fromBufferAttribute(positions, j).applyMatrix4(matrix);
        if (position.y < groundHeight(position.x, position.z)) below = true;
        else above = true;
      }
      assert.ok(below && above, 'Every surrounding rock is partly embedded in the terrain');
    }
  });
  const cushions = woodland.focusSurfaces.filter(mesh => mesh.name.startsWith('Outcrop moss '));
  const ray = new Raycaster(), up = new Vector3();
  woodland.group.updateMatrixWorld(true);
  assert.ok(woodland.stats.outcropMossRocks >= 30, 'Nearby grounded rocks carry modeled moss');
  woodland.group.traverse(object => {
    if (!object.isInstancedMesh || !object.name.startsWith('Ground rock moss shoots')) return;
    for (let i = 0; i < object.count; i += Math.max(1, Math.floor(object.count / 10))) {
      object.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
      up.setFromMatrixColumn(matrix, 1).normalize();
      ray.set(position.clone().addScaledVector(up, .12), up.clone().negate());
      const hit = ray.intersectObjects(cushions, false)[0];
      assert.ok(hit && hit.point.distanceTo(position) < .015, 'Shoot roots meet a rendered rock cushion');
    }
  });
  woodland.dispose(); material.dispose();
});

test('floor moss follows the terrain, leaves soil gaps, and supports its shoot roots', () => {
  const floor = createFloorMoss(groundHeight);
  const geometry = floor.carpet.geometry, p = geometry.attributes.position;
  const matrix = new Matrix4(), root = new Vector3(), ray = new Raycaster();
  floor.group.updateMatrixWorld(true);
  let raised = 0;
  for (let i = 0; i < p.count; i++) {
    const height = p.getY(i) - groundHeight(p.getX(i), p.getZ(i));
    assert.ok(height >= -.005 && height < .23, 'Cushions meet the soil without tall steps');
    if (height > .04) raised++;
  }
  assert.ok(raised > p.count * .1 && raised < p.count * .8, 'Raised colonies leave bare ground');
  for (const mesh of floor.group.children.filter(object => object.isInstancedMesh)) {
    for (let i = 0; i < mesh.count; i += 17) {
      mesh.getMatrixAt(i, matrix); root.setFromMatrixPosition(matrix);
      ray.set(root.clone().add(new Vector3(0, 1, 0)), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(floor.carpet)[0];
      assert.ok(hit && Math.abs(hit.point.y - root.y) < .025, 'Roots meet the rendered cushion triangles');
    }
  }
  floor.dispose();
});

test('simplified floor leaves are closed and face outwards', () => {
  const floor = createFloorMoss(groundHeight);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (const mesh of floor.group.children.filter(object => object.isInstancedMesh)) {
    const geometry = mesh.geometry, p = geometry.attributes.position, indices = geometry.index.array;
    const edges = new Map();
    let volume = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const triangle = Array.from(indices.subarray(i, i + 3));
      a.fromBufferAttribute(p, triangle[0]); b.fromBufferAttribute(p, triangle[1]); c.fromBufferAttribute(p, triangle[2]);
      volume += a.dot(b.clone().cross(c)) / 6;
      for (let k = 0; k < 3; k++) {
        const x = triangle[k], y = triangle[(k + 1) % 3], key = x < y ? `${x},${y}` : `${y},${x}`;
        const edge = edges.get(key) || [0, 0];
        edge[0]++; edge[1] += x < y ? 1 : -1; edges.set(key, edge);
      }
    }
    assert.ok(volume > 0);
    for (const edge of edges.values()) assert.deepEqual(edge, [2, 0]);
  }
  floor.dispose();
});
