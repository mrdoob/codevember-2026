import { MathUtils } from "three/webgpu";
import { SHOTS, VIDEO_SHOT_ORDER, frameAt } from "./camera-shots.js";

// A fixed low viewpoint, with space for the full projected rotation envelope.
export const REFERENCE_ASPECT = 1200 / 675;
export const REFERENCE_FOV = 68;
export const CAMERA_OFFSET = [-4.9, -1.4, 10.4];
export const TARGET_OFFSET = [-0.65, 0.2, 0];
export const CAMERA_ROLL = -0.004174922935695519;
export const CAMERA_VIEWS = [
  // The original view uses offsets from the installation's floating center.
  { position: CAMERA_OFFSET, target: TARGET_OFFSET, roll: CAMERA_ROLL },
  ...VIDEO_SHOT_ORDER.map((index) => {
    const shot = SHOTS[index];
    return frameAt(shot.startFrame + Math.floor(shot.frames / 2));
  }),
];

export function framing(aspect, viewIndex = 0) {
  if (viewIndex !== 0) {
    const view = CAMERA_VIEWS[viewIndex];
    // Match the square video, widening vertically on narrow screens.
    const fov = MathUtils.radToDeg(
      2 *
        Math.atan(
          Math.tan(MathUtils.degToRad(view.fov / 2)) * Math.max(1, 1 / aspect),
        ),
    );
    return { fov, x: view.target[0] };
  }
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
