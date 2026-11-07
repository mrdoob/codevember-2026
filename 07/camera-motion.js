import { Vector3 } from "three/webgpu";
import { mod } from "./journey.js";

export const CAMERA_DISTANCE = 8.6;
const ORBIT_SPEED = 0.72;

// Fixed seeded phases and unrelated frequencies make a repeatable wandering
// orbit. Reduce phases before sin() so long sessions keep bounded arguments.
const wave = (depth, frequency, phase) =>
  Math.sin(mod(depth * frequency + phase, Math.PI * 2));
export function cameraAngles(depth, amount = 1, cycleLength = 0) {
  // Whole harmonics close both the position and velocity of a capture loop.
  const sample = (frequency, phase) => {
    if (!cycleLength) return wave(depth, frequency, phase);
    const harmonic = Math.max(
      1,
      Math.round((frequency * cycleLength) / (Math.PI * 2)),
    );
    return Math.sin(
      (mod(depth, cycleLength) / cycleLength) * Math.PI * 2 * harmonic + phase,
    );
  };
  return {
    yaw: orbitYaw(depth, 0, true, cycleLength),
    pitch:
      amount *
      (sample(0.61, 0.3) * 0.02 +
        sample(1.13, 2.1) * 0.014 +
        sample(1.87, 4.2) * 0.006),
    lookYaw: amount * (sample(0.73, 0.4) * 0.018 + sample(1.31, 2.2) * 0.009),
    roll: 0,
  };
}

export const orbitYaw = (depth, turnY = 0, orbit = true, cycleLength = 0) =>
  (orbit
    ? cycleLength > 0
      ? (mod(depth, cycleLength) / cycleLength) * Math.PI * 2
      : mod(depth * ORBIT_SPEED, Math.PI * 2)
    : 0) + turnY;

// The orbit and sculpture share a frame. Departing centers spread out
// mostly across its XY plane while the camera stays on its Z axis. Fixed,
// oblique split normals keep the seam readable and leave the camera clear.
export function cameraDirection(
  depth,
  turnY = 0,
  orbit = true,
  target = new Vector3(),
  cycleLength = 0,
) {
  const yaw = orbitYaw(depth, turnY, orbit, cycleLength);
  return target.set(Math.sin(yaw), 0, Math.cos(yaw));
}
