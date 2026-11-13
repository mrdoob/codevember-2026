import { CAMERA } from '../scene-constants.js';

export const FPS = 30;
export const SIZE = 1024;
export const DURATION = 60;
export const TOTAL_FRAMES = FPS * DURATION;
export const ORBIT_SPEED = 360 / DURATION;

// Constant angular speed; the descent eases gently at both ends. Translate
// camera and target together, retaining the interactive view's fixed pitch.
export function cameraPose(seconds) {
  const t = Math.max(0, Math.min(1, seconds / DURATION));
  const descent = t * t * (3 - 2 * t);
  const angle = t * 2 * Math.PI;
  const polar = (90 - CAMERA.elevation) * Math.PI / 180;
  const height = CAMERA.maxHeight + (CAMERA.minHeight - CAMERA.maxHeight) * descent;
  const radius = CAMERA.radius * Math.sin(polar);
  return {
    angle,
    position: [radius * Math.sin(angle), height, radius * Math.cos(angle)],
    target: [0, height - CAMERA.radius * Math.cos(polar), 0],
  };
}
