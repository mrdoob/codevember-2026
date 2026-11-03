import test from 'node:test';
import { readFileSync } from 'node:fs';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { LETTER_SHARDS, letterGeometry, letterSeed } from '../letters.js';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { PRIMITIVES, primitiveGeometry, fractureGeometry } from '../fracture.js';
import { ShatterSimulation } from '../simulation.js';

function measure(geometry) {
  const p = geometry.attributes.position, index = geometry.index;
  const count = index ? index.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const areaVector = new THREE.Vector3(); let volume = 0;
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(p, index ? index.getX(i) : i);
    b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1);
    c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
    areaVector.add(b.sub(a).cross(c.sub(a)).multiplyScalar(0.5));
  }
  return { volume, areaVector };
}

const font = new FontLoader().parse(JSON.parse(readFileSync(new URL('../assets/helvetiker_bold.typeface.json', import.meta.url))));
const templates = new Map();
for (const shape of [...PRIMITIVES, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
  test(`${shape}: solid fragments conserve volume and close every cut`, () => {
    const isLetter = /^[A-Z]$/.test(shape);
    const source = isLetter ? letterGeometry(shape, font) : primitiveGeometry(shape);
    const count = isLetter ? LETTER_SHARDS : shape === 'Torus' ? 68 : 64;
    const seed = isLetter ? letterSeed(shape) : PRIMITIVES.indexOf(shape) * 71 + 13;
    const shards = fractureGeometry(source, count, seed, shape);
    templates.set(shape, shards);
    if (isLetter) assert.ok(shards.length >= count && shards.length < count * 2);
    else assert.equal(shards.length, count);
    const expected = measure(source).volume;
    let actual = 0;
    for (const shard of shards) {
      const { volume, areaVector } = measure(shard.geometry);
      assert.ok(volume > 0, 'each fragment encloses positive volume');
      assert.ok(areaVector.length() < 1e-5, `uncapped face: ${areaVector.length()}`);
      assert.ok(Math.abs(volume - shard.volume) < 1e-5);
      for (const value of shard.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
      assert.ok(shard.geometry.attributes.glassThickness.getX(0) > 0);
      const hulls = shard.collisionParts.map(points => {
        assert.ok(points.length / 3 <= 40, 'Box3D hull limit');
        const vertices = []; for (let i = 0; i < points.length; i += 3) vertices.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
        return new ConvexHull().setFromPoints(vertices);
      });
      for (const counter of source.userData.counterCenters || []) {
        const local = counter.clone().sub(shard.center);
        assert.ok(hulls.every(hull => !hull.containsPoint(local)), `${shape}: a collider blocks a letter opening`);
      }
      for (const point of shard.support) {
        const error = Math.min(...hulls.map(hull => Math.max(...hull.faces.map(face => face.distanceToPoint(point)))));
        assert.ok(error <= 0.0011, 'collision simplification exceeds 1 mm');
      }
      actual += volume;
    }
    assert.ok(Math.abs(actual - expected) / expected < 1e-5, `${actual} != ${expected}`);
    source.dispose();
  });
}

test('impact conserves mass and momentum without adding energy; debris collides and settles', () => {
  for (const [shape, shards] of templates) {
    let impacts = 0;
    const simulation = new ShatterSimulation(() => impacts++);
    try {
      const body = simulation.drop(shards, /^[A-Z]$/.test(shape) ? { rotation: new THREE.Euler(-0.5, 0.35, 0), angularVelocity: new THREE.Vector3(0, 0.3, -0.15) } : {});
      let shardContact = false;
      for (let frame = 0; frame < (/^[A-Z]$/.test(shape) ? 2400 : 1800); frame++) {
        simulation.update(1 / 120);
        for (const fragment of body.fragments) {
          assert.ok(simulation.bottom(fragment) >= -0.001, `${shape}: excessive floor penetration`);
          assert.ok(Number.isFinite(fragment.position.lengthSq()));
        }
        if (frame === 30) assert.equal(body.broken, false, 'broke in midair');
        shardContact ||= simulation.hadShardContact;
      }
      assert.equal(impacts, 1);
      assert.ok(shardContact, 'no shard-to-shard contact was resolved');
      const stats = body.fractureStats;
      assert.ok(Math.abs(stats.massBefore - stats.massAfter) / stats.massBefore < 1e-5);
      assert.ok(stats.energyAfter <= stats.energyBefore * 1.00001, 'fracture created kinetic energy');
      assert.ok(stats.momentumAfter.distanceTo(stats.momentumBefore) / Math.max(1, stats.momentumBefore.length()) < 1e-4, 'fracture changed net momentum');
      assert.ok(body.fragments.filter(f => f.sleeping).length >= shards.length * 0.85, `${shape}: debris never settled`);
      assert.ok(Math.min(...body.fragments.map(f => simulation.bottom(f))) > -0.001, `${shape}: resting floor penetration`);
    } finally { simulation.dispose(); }
  }
});

test('fixed steps produce the same fracture motion at 30 and 120 fps', () => {
  const a = new ShatterSimulation(), b = new ShatterSimulation();
  try {
    const shards = templates.get('Sphere');
    a.drop(shards); b.drop(shards);
    for (let i = 0; i < 90; i++) a.update(1 / 30);
    for (let i = 0; i < 360; i++) b.update(1 / 120);
    a.bodies[0].fragments.forEach((f, i) => {
      assert.ok(f.position.distanceTo(b.bodies[0].fragments[i].position) < 1e-8);
      assert.ok(Math.abs(f.quaternion.dot(b.bodies[0].fragments[i].quaternion)) > 0.99999);
    });
  } finally { a.dispose(); b.dispose(); }
});

test('a gentle contact remains intact, and removing drops releases their physics bodies', () => {
  const simulation = new ShatterSimulation();
  try {
    const body = simulation.drop(templates.get('Cube'), { height: 1.8, toughness: 100 });
    for (let i = 0; i < 1200; i++) simulation.update(1 / 120);
    assert.equal(body.broken, false);
    assert.ok(body.sleeping);
    simulation.remove(body);
    assert.equal(simulation.counts.bodies, 0);
    assert.equal(simulation.counts.colliders, 1, 'only the floor should remain');
    assert.equal(simulation.intactColliders.size, 0);
    const broken = simulation.drop(templates.get('Cube'));
    for (let i = 0; i < 240; i++) simulation.update(1 / 120);
    assert.ok(broken.broken);
    simulation.clear();
    assert.equal(simulation.counts.bodies, 0);
    assert.equal(simulation.counts.colliders, 1);
  } finally { simulation.dispose(); }
});

test('a later drop can fracture on existing debris above the floor', () => {
  const simulation = new ShatterSimulation();
  try {
    simulation.drop(templates.get('Cube'));
    for (let i = 0; i < 1200; i++) simulation.update(1 / 120);
    const second = simulation.drop(templates.get('Sphere'));
    for (let i = 0; i < 240 && !second.broken; i++) simulation.update(1 / 120);
    assert.ok(second.broken);
    assert.ok(second.impactPoint.y > 0.05, 'second drop ignored the debris pile');
  } finally { simulation.dispose(); }
});
