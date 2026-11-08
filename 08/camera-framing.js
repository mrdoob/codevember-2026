import { MathUtils } from "three/webgpu";

// A fixed low viewpoint, with space for the full projected rotation envelope.
export const REFERENCE_ASPECT = 1200 / 675;
export const REFERENCE_FOV = 68;
export const CAMERA_OFFSET = [-4.9, -1.4, 10.4];
export const TARGET_OFFSET = [-0.65, 0.2, 0];
export const CAMERA_ROLL = -0.004174922935695519;
export const CAMERA_VIEWS = [
  CAMERA_OFFSET,
  [12, 1.8, 7],
  [8, 3.6, -13],
  [-14, -1.5, -7],
  [-10, 3.7, 11],
  [1, -0.7, 22],
  [2, -2.8, 8.6],
];

export function framing(aspect) {
  // Center the installation on small screens; preserve the photograph's
  // negative space to the left in wide views.
  const composition = MathUtils.smoothstep(aspect, 0.75, 1.5);
  const fov = MathUtils.radToDeg(
    2 *
      Math.atan(
        Math.tan(MathUtils.degToRad(REFERENCE_FOV / 2)) *
          Math.max(1, 1.45 / aspect),
      ),
  );
  return { fov, x: TARGET_OFFSET[0] * composition };
}
