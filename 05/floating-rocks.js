import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import { STONE_CENTER, STONE_SCALE, surfacePoint } from './stone.js';
import { smootherstep } from './random.js';

export const ROCK_LAYOUT = [
  { center: [0, 2.05, 0], scale: .70, rotation: [.04, -.25, -.06], phase: 0, width: .8 },
  { center: [-1.90, 3.15, -.40], scale: .22, rotation: [-.12, 1.15, .12], phase: 1.8 },
  { center: [2.15, 2.45, .15], scale: .25, rotation: [.10, 2.5, -.12], phase: 3.6 },
  { center: [-1.75, 1.05, .40], scale: .18, rotation: [-.08, -1.3, .14], phase: 5.2 }
];

export function rockLiftProgress(layout, time) {
  return smootherstep(0, 4.8, time - .35 - layout.phase * .16);
}

// A longer camera move gently trails the ascent and settles after the stones.
// Absolute animation time keeps pause, replay, and manual stepping consistent.
export function cameraLiftProgress(time) {
  return smootherstep(0, 6.4, time - .45);
}

// Fit the actual scaled, tilted stone to the terrain and its moss carpet once.
// A shallow inset seats it in the leaves without an initial hovering gap.
export function groundedRockHeight(geometry, layout, heightAt) {
  const rotation = new Quaternion().setFromEuler(new Euler(...layout.rotation));
  const point = new Vector3(), positions = geometry.attributes.position;
  let height = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).sub(STONE_CENTER).multiplyScalar(layout.scale).applyQuaternion(rotation);
    if (point.y > 0) continue;
    height = Math.max(height, heightAt(point.x + layout.center[0], point.z + layout.center[2]) - point.y);
  }
  return height - .012;
}

export function rockPositionAt(layout, time, position) {
  const { center, phase } = layout;
  const lift = layout.groundY === undefined ? 1 : rockLiftProgress(layout, time);
  const groundY = layout.groundY ?? center[1];
  return position.set(center[0], groundY + (center[1] + Math.sin(time * .45 + phase) * .09 - groundY) * lift, center[2]);
}

export function updateRockPose(pivot, layout, time) {
  const { rotation, phase } = layout;
  const lift = layout.groundY === undefined ? 1 : rockLiftProgress(layout, time);
  rockPositionAt(layout, time, pivot.position);
  pivot.rotation.set(rotation[0] + Math.sin(time * .27 + phase) * .025 * lift,
    rotation[1] + Math.sin(time * .19 + phase) * .08 * lift,
    rotation[2] + Math.cos(time * .31 + phase) * .025 * lift);
}

const direction = new Vector3(), surface = new Vector3();
const localPosition = new Vector3();

export function distanceToRockSurface(position, rocks) {
  let nearest = Infinity;
  for (const rock of rocks) {
    rock.bundle.worldToLocal(localPosition.copy(position));
    direction.copy(localPosition).sub(STONE_CENTER).divide(STONE_SCALE);
    direction.x /= rock.layout.width ?? 1;
    direction.normalize();
    surfacePoint(direction, true, surface, rock.layout.width);
    rock.bundle.localToWorld(surface);
    nearest = Math.min(nearest, Math.max(0, position.distanceTo(surface) - .09));
  }
  return nearest;
}

// Work in each rock's own coordinates so orbit/zoom clearance follows its
// scale, tilt, and floating motion, rather than an invisible stone at the origin.
export function keepOutsideRocks(position, rocks) {
  let moved = false;
  for (const rock of rocks) {
    rock.bundle.updateWorldMatrix(true, false);
    const local = rock.bundle.worldToLocal(localPosition.copy(position));
    direction.copy(local).sub(STONE_CENTER).divide(STONE_SCALE);
    const width = rock.layout.width ?? 1;
    direction.x /= width;
    const distance = direction.length();
    if (distance > 2) continue;
    if (distance < 1e-6) direction.set(0, 1, 0); else direction.divideScalar(distance);
    surfacePoint(direction, true, surface, width).sub(STONE_CENTER).divide(STONE_SCALE);
    surface.x /= width;
    const minimum = surface.length() + .16 / rock.layout.scale;
    if (distance < minimum) {
      local.copy(direction).multiplyScalar(minimum).multiply(STONE_SCALE);
      local.x *= width;
      local.add(STONE_CENTER);
      position.copy(rock.bundle.localToWorld(local));
      moved = true;
    }
  }
  return moved;
}
