import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { createStoneGeometry, STONE_CENTER } from '../stone.js';
import { createFocusVolume } from '../focus-volume.js';
import { createFireflies, FIREFLY_COUNT, FIREFLY_INTENSITY } from '../fireflies.js';
import { groundHeight } from '../woodland.js';
import { ROCK_LAYOUT, groundedRockHeight, rockLiftProgress, updateRockPose, keepOutsideRocks } from '../floating-rocks.js';
import { floorColonyAt } from '../floor-moss.js';
import { createBackgroundLight } from '../background-light.js';

test('the background light follows a deterministic path above the terrain and can be disabled', () => {
  const background = createBackgroundLight(), light = background.light;
  const first = light.position.clone();
  for (let time = 0; time < 120; time += .5) {
    background.update(time);
    const { x, y, z } = light.position;
    assert.ok(y >= groundHeight(x, z) + 1.49 && z < -4.8);
    assert.ok([x, y, z, light.intensity].every(Number.isFinite));
  }
  assert.ok(light.position.distanceTo(first) > .1);
  background.update(0); assert.deepEqual(light.position.toArray(), first.toArray());
  background.update(0, false); assert.equal(light.visible, false); assert.equal(light.intensity, 0);
  background.dispose();
});

test('every stone and cushion vertex remains in focus through orbit, pan, and macro zoom', () => {
  const group = new Group(), material = new MeshBasicMaterial();
  const geometries = [createStoneGeometry(), createStoneGeometry(true)];
  for (const geometry of geometries) group.add(new Mesh(geometry, material));
  const focus = createFocusVolume(group), camera = new PerspectiveCamera(38, 1.4, .015, 120);
  const point = new Vector3();
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12, radius = i % 3 ? 8 : 1.7;
    camera.position.set(Math.cos(angle) * radius, i % 2 ? 2 : 6, Math.sin(angle) * radius);
    camera.lookAt(i % 2 ? .4 : 0, 1.1, i % 3 ? 0 : .7);
    const range = focus.update(camera);
    assert.ok(range.near >= camera.near && range.far >= range.near);
    for (const geometry of geometries) {
      const positions = geometry.attributes.position;
      for (let j = 0; j < positions.count; j++) {
        const depth = -point.fromBufferAttribute(positions, j).applyMatrix4(camera.matrixWorldInverse).z;
        if (depth < camera.near) continue;
        assert.ok(depth >= range.near && depth <= range.far, `View ${i}, vertex ${j} is sharp`);
      }
    }
  }
  for (const geometry of geometries) geometry.dispose();
  material.dispose();
});

test('firefly paths are deterministic, stay above terrain, and move their lights with their lanterns', () => {
  const flies = createFireflies(ROCK_LAYOUT);
  assert.equal(flies.lights.length, FIREFLY_COUNT);
  const first = flies.positions.array.slice(), firstGlow = flies.glows.array.slice();
  for (let time = 0; time < 60; time += .5) {
    flies.update(time);
    flies.lights.forEach((light, i) => {
      const { x, y, z } = light.position;
      assert.ok([x, y, z, light.intensity].every(Number.isFinite));
      assert.ok(y > groundHeight(x, z) + .05, 'Lantern remains above the soil');
      assert.ok(light.intensity >= 0 && light.intensity <= FIREFLY_INTENSITY);
      assert.ok(light.position.distanceTo(new Vector3().fromBufferAttribute(flies.positions, i)) < 1e-6);
    });
    const levels = flies.lights.map(light => light.intensity);
    const points = flies.lights.map(light => light.position.clone());
    flies.update(time + 1 / 60);
    flies.lights.forEach((light, i) => {
      assert.ok(Math.abs(light.intensity - levels[i]) < FIREFLY_INTENSITY * .03, 'Light fades smoothly, including across pulse boundaries');
      assert.ok(light.position.distanceTo(points[i]) < .006, 'Ambient flight has no jumps');
    });
  }
  assert.notDeepEqual(flies.positions.array, first);
  flies.update(0);
  assert.deepEqual(flies.positions.array, first);
  assert.deepEqual(flies.glows.array, firstGlow);
  flies.update(0, false);
  assert.equal(flies.group.visible, false);
  assert.ok(flies.lights.every(light => light.intensity === 0));
  flies.dispose();
});

test('rocks start at the floor and rise smoothly into their floating positions', () => {
  const heightAt = (x, z) => groundHeight(x, z) + floorColonyAt(x, z).height - .004;
  const point = new Vector3();
  for (const placement of ROCK_LAYOUT) {
    const geometry = createStoneGeometry(false, 120, 80, placement.width);
    const layout = { ...placement, groundY: groundedRockHeight(geometry, placement, heightAt) };
    const pivot = new Group(), bundle = new Group();
    bundle.scale.setScalar(layout.scale); bundle.position.copy(STONE_CENTER).multiplyScalar(-layout.scale); pivot.add(bundle);
    updateRockPose(pivot, layout, 0); pivot.updateMatrixWorld(true);
    let clearance = Infinity;
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      point.fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(bundle.matrixWorld);
      clearance = Math.min(clearance, point.y - heightAt(point.x, point.z));
    }
    assert.ok(Math.abs(clearance + .012) < 1e-6, 'Stone rests just inside the carpet, without a gap');
    const start = pivot.position.clone(), orientation = pivot.quaternion.clone();
    updateRockPose(pivot, layout, .35);
    assert.deepEqual(pivot.position.toArray(), start.toArray(), 'Opening hold stays on the ground');
    assert.deepEqual(pivot.quaternion.toArray(), orientation.toArray());
    let previous = start.y;
    for (let time = .4; time < 4.8; time += .05) {
      updateRockPose(pivot, layout, time);
      assert.ok(pivot.position.y >= previous - 1e-8, 'The ascent never dips back into the ground');
      previous = pivot.position.y;
    }
    updateRockPose(pivot, layout, 4.75);
    const held = pivot.position.clone(); updateRockPose(pivot, layout, 4.75);
    assert.ok(pivot.position.distanceTo(held) < 1e-8, 'Repeated animation time does not change the pose');
    const floating = new Group();
    updateRockPose(pivot, layout, 6); updateRockPose(floating, placement, 6);
    assert.ok(pivot.position.distanceTo(floating.position) < 1e-9 && pivot.quaternion.angleTo(floating.quaternion) < 1e-7);
    const end = .35 + placement.phase * .16 + 4.8;
    assert.ok(rockLiftProgress(layout, end - .001) > 1 - 1e-8, 'The lift eases smoothly into hovering');
    updateRockPose(pivot, layout, 0); assert.deepEqual(pivot.position.toArray(), start.toArray(), 'Resetting time replays the opening');
    geometry.dispose();
  }
  assert.ok(rockLiftProgress(ROCK_LAYOUT[0], 1) > rockLiftProgress(ROCK_LAYOUT[3], 1), 'Companions lift with a stagger');
});

test('four moving rocks keep focus and camera clearance without carrying their fireflies', () => {
  const group = new Group(), material = new MeshBasicMaterial();
  const geometries = ROCK_LAYOUT.map(layout => createStoneGeometry(true, 120, 80, layout.width));
  const rocks = ROCK_LAYOUT.map((layout, i) => {
    const pivot = new Group(), bundle = new Group();
    bundle.scale.setScalar(layout.scale);
    bundle.position.copy(STONE_CENTER).multiplyScalar(-layout.scale);
    bundle.add(new Mesh(geometries[i], material)); pivot.add(bundle); group.add(pivot);
    updateRockPose(pivot, layout, 0);
    return { pivot, bundle, layout, geometry: geometries[i] };
  });
  group.updateMatrixWorld(true);
  const layouts = ROCK_LAYOUT.map(layout => ({ ...layout, center: [...layout.center] }));
  const focus = createFocusVolume(group), flies = createFireflies(layouts);
  const camera = new PerspectiveCamera(38, 1.4, .015, 120), point = new Vector3();
  for (let time = 0; time < 24; time += 2) {
    for (const rock of rocks) updateRockPose(rock.pivot, rock.layout, time);
    group.updateMatrixWorld(true); flies.update(time);
    camera.position.set(Math.cos(time) * 7, 3, Math.sin(time) * 7);
    camera.lookAt(0, 2.2, 0);
    const range = focus.update(camera);
    for (const rock of rocks) {
      const geometry = rock.geometry;
      for (let i = 0; i < geometry.attributes.position.count; i += 17) {
        point.fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(rock.bundle.matrixWorld);
        assert.ok(point.y > groundHeight(point.x, point.z) + .25, 'Stone floats clear of soil');
        const depth = -point.applyMatrix4(camera.matrixWorldInverse).z;
        assert.ok(depth >= range.near && depth <= range.far, 'Moving stone remains in focus');
      }
      point.copy(rock.pivot.position);
      assert.ok(keepOutsideRocks(point, rocks));
      assert.ok(point.distanceTo(rock.pivot.position) > .2, 'Camera leaves the rock interior');
    }
    for (let i = 0; i < 24; i++) {
      const rock = rocks[i % rocks.length];
      assert.ok(flies.lights[i].position.distanceTo(new Vector3(...rock.layout.center)) < rock.layout.scale * 2.4 + .55, 'Near fireflies remain in the clearing');
    }
  }
  const positions = flies.positions.array.slice();
  const lights = flies.lights.map(light => light.position.toArray());
  for (const rock of rocks) {
    rock.pivot.position.add(new Vector3(3, 2, -4));
    rock.pivot.rotation.set(.4, 1.8, -.2);
    rock.bundle.scale.multiplyScalar(.5);
  }
  group.updateMatrixWorld(true);
  for (const layout of layouts) { layout.center[0] += 10; layout.scale *= 2; layout.groundY = 10; layout.phase += 3; }
  flies.update(22);
  assert.deepEqual(flies.positions.array, positions, 'Rock movement and layout mutation cannot carry the lanterns');
  assert.deepEqual(flies.lights.map(light => light.position.toArray()), lights, 'Lights stay at the same world positions too');
  flies.update(22, true, 1, false);
  assert.deepEqual(flies.positions.array, positions, 'Light toggle leaves visible lanterns in place');
  assert.ok(flies.lights.every(light => light.intensity === 0));
  assert.equal(flies.glowScene.children[0].visible, true);
  flies.dispose(); geometries.forEach(geometry => geometry.dispose()); material.dispose();
});
