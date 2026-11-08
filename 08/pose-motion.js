import { LOOP_SECONDS, TAU, rotation4 } from "./hypercube.js";

// Angles in the XW, YW, ZW, XY, XZ, and YZ planes, in quarter-pi units.
export const KEY_POSES = [
  [0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0],
  [1, 0.8, 0, 0.3, 0, 0],
  [0, 1, 0.6, 0.3, -0.3, 0],
  [-0.7, 1, 1, 0, -0.3, 0.3],
  [-1, 0.2, 1.3, -0.5, 0, 0.3],
  [-0.4, -0.8, 0.8, -0.5, 0.5, 0],
  [0.4, -1, 0, 0, 0.5, -0.5],
  [1.2, -0.4, -0.6, 0.5, 0.2, -0.5],
  [0.6, 0.5, -1, 0.5, -0.4, 0],
  [-0.3, 1.1, -0.8, 0, -0.4, 0.6],
  [-1, 0.6, 0, -0.6, 0, 0.6],
  [-1.3, -0.3, 0.5, -0.6, 0.4, 0],
  [-0.6, -1.1, 1.1, 0, 0.4, -0.6],
  [0.3, -0.6, 1.4, 0.6, 0, -0.6],
  [1, 0.3, 0.7, 0.6, -0.5, 0],
  [0.8, 1.2, -0.2, 0, -0.5, 0.5],
  [0, 0.6, -1.2, -0.5, 0, 0.5],
  [-0.8, -0.3, -1.4, -0.5, 0.6, 0],
  [-1.1, -1, -0.6, 0, 0.6, -0.4],
  [-0.2, -0.7, 0.4, 0.4, 0.2, -0.4],
  [0.9, 0, 0.9, 0.4, -0.4, 0],
  [0.7, 0.7, 0.4, 0, -0.4, 0.4],
  [0, 0.5, -0.3, -0.3, 0, 0.4],
].map((angles) => angles.map((a) => (a * Math.PI) / 4));
export const POSE_COUNT = KEY_POSES.length;
export const POSE_INTERVAL = 10;
export const POSE_HOLD = POSE_INTERVAL * 0.4;
export const POSE_LOOP_SECONDS = POSE_COUNT * POSE_INTERVAL;
export const BLINK_PER_RADIAN = 2.5;
const clamp = (x) => Math.max(0, Math.min(1, x));
const distances = KEY_POSES.map((angles, i) =>
  Math.hypot(...angles.map((a, j) => KEY_POSES[(i + 1) % POSE_COUNT][j] - a)),
);
const cumulative = [0];
for (const d of distances) cumulative.push(cumulative.at(-1) + d);

// Hold each projected form, then ease the 4D rotation parameter to the next.
// The rotation itself stays orthogonal; matrices and vertices are not blended.
export function poseMotion(time, mode = "Multi-axis poses") {
  const wrapped =
    ((time % POSE_LOOP_SECONDS) + POSE_LOOP_SECONDS) % POSE_LOOP_SECONDS;
  const index = Math.floor(wrapped / POSE_INTERVAL),
    local = wrapped - index * POSE_INTERVAL;
  const progress = clamp((local - POSE_HOLD) / (POSE_INTERVAL - POSE_HOLD));
  const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
  const multi = mode === "Multi-axis poses";
  const legacy =
    ((TAU * POSE_INTERVAL) / LOOP_SECONDS) *
    (mode === "Double rotation" ? Math.SQRT2 : 1);
  const distance = multi ? distances[index] : legacy;
  const travel =
    (multi ? cumulative[index] : index * legacy) + eased * distance;
  const velocity =
    (distance * 30 * progress ** 2 * (1 - progress) ** 2) /
    (POSE_INTERVAL - POSE_HOLD);
  return {
    index,
    time: (index + eased) * POSE_INTERVAL,
    progress,
    eased,
    travel,
    velocity,
    totalTravel: multi ? cumulative.at(-1) : POSE_COUNT * legacy,
    moving: progress > 0 && progress < 1,
  };
}

export function poseRotation(
  pose,
  mode = "Multi-axis poses",
  offsetX = 0,
  offsetY = 0,
) {
  if (mode !== "Multi-axis poses")
    return rotation4(pose.time, mode, offsetX, offsetY);
  const angles = KEY_POSES[pose.index].map(
    (a, i) =>
      a + (KEY_POSES[(pose.index + 1) % POSE_COUNT][i] - a) * pose.eased,
  );
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function rotate(a, b, angle) {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    for (let col = 0; col < 4; col++) {
      const i = col * 4,
        x = matrix[i + a],
        y = matrix[i + b];
      matrix[i + a] = c * x - s * y;
      matrix[i + b] = s * x + c * y;
    }
  }
  [
    [0, 3],
    [1, 3],
    [2, 3],
    [0, 1],
    [0, 2],
    [1, 2],
  ].forEach(([a, b], i) => rotate(a, b, angles[i]));
  rotate(0, 3, offsetX);
  rotate(1, 3, offsetY);
  return matrix;
}
