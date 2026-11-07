import { Vector3 } from "three/webgpu";
import { mod } from "./journey.js";

export const CAMERA_DISTANCE = 8.6;
const ORBIT_SPEED = 0.72;

// Fixed seeded phases and unrelated frequencies make a repeatable wandering
// orbit. Reduce phases before sin() so long sessions keep bounded arguments.
const wave = (depth, frequency, phase) =>
  Math.sin(mod(depth * frequency + phase, Math.PI * 2));
export function cameraAngles(depth, amount = 1) {
  return {
    yaw: orbitYaw(depth),
    pitch:
      amount *
      (wave(depth, 0.61, 0.3) * 0.02 +
        wave(depth, 1.13, 2.1) * 0.014 +
        wave(depth, 1.87, 4.2) * 0.006),
    lookYaw:
      amount *
      (wave(depth, 0.73, 0.4) * 0.018 + wave(depth, 1.31, 2.2) * 0.009),
    roll: 0,
  };
}

export const orbitYaw = (depth, turnY = 0, orbit = true) =>
  (orbit ? mod(depth * ORBIT_SPEED, Math.PI * 2) : 0) + turnY;

// The orbit and sculpture share a frame. Departing centers spread out
// mostly across its XY plane while the camera stays on its Z axis. Fixed,
// oblique split normals keep the seam readable and leave the camera clear.
export function cameraDirection(
  depth,
  turnY = 0,
  orbit = true,
  target = new Vector3(),
) {
  const yaw = orbitYaw(depth, turnY, orbit);
  return target.set(Math.sin(yaw), 0, Math.cos(yaw));
}
