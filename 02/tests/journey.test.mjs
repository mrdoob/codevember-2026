import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3, Frustum, Matrix4, Sphere } from 'three/webgpu';
import { CameraJourney } from '../journey.js';
import { PRIMITIVES, primitiveGeometry } from '../fracture.js';

test('camera travel preserves launch distance, leaves world-space debris behind, and resets', () => {
  const camera = new PerspectiveCamera(); camera.position.set(5.5, 2.8, 9.5);
  const controls = { target: new Vector3(0, 1.5, 0) };
  camera.lookAt(controls.target);
  const journey = new CameraJourney(camera, controls);
  const originalCamera = camera.position.clone(), originalTarget = controls.target.clone();
  const initialOffset = camera.position.clone().sub(journey.launchPoint);
  const oldDebris = new Vector3(0, 0.2, 0);
  for (let i = 0; i < 1200; i++) journey.advance(1 / 60, 1.4);
  assert.ok(camera.position.clone().sub(journey.launchPoint).distanceTo(initialOffset) < 1e-9);
  assert.ok(Math.abs(journey.launchPoint.length() - 28) < 1e-9);
  assert.ok(journey.launchPoint.dot(originalTarget.clone().sub(originalCamera).setY(0)) > 0, 'travel must move forward');
  assert.deepEqual(oldDebris.toArray(), [0, 0.2, 0]);
  assert.equal(journey.outOfRange({ broken: true, fragments: [{ position: oldDebris }] }), true);
  journey.reset();
  assert.ok(camera.position.distanceTo(originalCamera) < 1e-9);
  assert.ok(controls.target.distanceTo(originalTarget) < 1e-9);
  assert.equal(journey.launchPoint.length(), 0);
});

test('trail cleanup waits until every fragment is beyond the fog; travel follows orbit direction', () => {
  const camera = new PerspectiveCamera(); camera.position.set(0, 7, 15);
  const controls = { target: new Vector3(0, 2, 0) };
  camera.lookAt(controls.target);
  const journey = new CameraJourney(camera, controls);
  journey.advance(10, 1);
  camera.position.set(15, 7, -10);
  camera.lookAt(controls.target);
  journey.advance(5, 1);
  assert.ok(journey.launchPoint.distanceTo(new Vector3(-5, 0, -10)) < 1e-9);
  const far = { position: new Vector3(0, 0, -80) }, near = { position: new Vector3(5, 0, 10) };
  assert.equal(journey.outOfRange({ broken: true, fragments: [far, near] }), false);
  assert.equal(journey.outOfRange({ broken: true, fragments: [far] }), true);
});


test('spawns clear the top of the view for every primitive, aspect ratio, zoom, and orbit elevation', () => {
  const radii = PRIMITIVES.map(shape => {
    const geometry = primitiveGeometry(shape); geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere.radius + geometry.boundingSphere.center.length();
    geometry.dispose(); return radius;
  });
  for (const aspect of [0.46, 1, 1.8, 2.4]) for (const distance of [9, 11, 25]) for (const elevation of [0.04, 0.12, 0.7, 1.4]) {
    const fov = 2 * Math.atan(Math.max(Math.tan(21 * Math.PI / 180), Math.tan(17 * Math.PI / 180) / aspect)) * 180 / Math.PI;
    const camera = new PerspectiveCamera(fov, aspect, 0.1, 80);
    const controls = { target: new Vector3(0, 1.5, 0) };
    camera.position.set(distance * Math.cos(elevation) * 0.5, 1.5 + distance * Math.sin(elevation), distance * Math.cos(elevation) * Math.sqrt(0.75));
    camera.lookAt(controls.target);
    const journey = new CameraJourney(camera, controls);
    journey.advance(20, 1.4);
    for (const radius of radii) {
      const height = journey.spawnHeight(radius, 5.8);
      const center = journey.launchPoint.clone().setY(height);
      const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      assert.ok(Number.isFinite(height) && height >= 5.8);
      assert.ok(frustum.planes[3].distanceToPoint(center) <= -radius - 0.2499, 'object starts partially on-screen');
      assert.equal(frustum.intersectsSphere(new Sphere(center, radius)), false);
    }
  }
});


test('passed-drop cleanup keeps the whole drop until its last shard clears the camera', () => {
  const camera = new PerspectiveCamera(); camera.position.set(0, 2, 0); camera.lookAt(0, 2, -10);
  const journey = new CameraJourney(camera, { target: new Vector3(0, 2, -10) });
  const shard = z => ({ position: new Vector3(0, 0.5, z), geometry: { boundingSphere: new Sphere(new Vector3(), 0.6) } });
  assert.equal(journey.outOfRange({ broken: true, fragments: [shard(4), shard(-1)] }), false);
  assert.equal(journey.outOfRange({ broken: true, fragments: [shard(4), shard(0.4)] }), false, 'part of the last shard is still visible');
  assert.equal(journey.outOfRange({ broken: true, fragments: [shard(4), shard(1.2)] }), true);
});
