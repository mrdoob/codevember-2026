// Landmark and crop dimensions share scene units; feathers remain art directed.
// The viewing angle stays fixed as the camera and orbit target move vertically.
export const CAMERA = Object.freeze({
  radius: 6,
  minDistance: 5,
  maxDistance: 11,
  near: .1,
  far: 100,
  fov: 40,
  portraitFov: 46,
  portraitAspect: .8,
  elevation: -10,
  height: -1.75,
  minHeight: -2.5,
  maxHeight: 5,
});

// Deep central floor and the feather's below-ground recycling/masking limit.
// The surrounding field surface is defined in field-terrain.js.
export const GROUND_Y = -24;
// Every edge lies beyond the ground's fade into the landscape, for any orbit.
export const GROUND_SIZE = 2 * (CAMERA.maxDistance + CAMERA.far);

// Reference radius for outer straw, independent of the opening camera distance.
export const WHEAT_INNER_RADIUS = 18;
export const WHEAT_OUTER_RADIUS = 46;
export const WHEAT_SCALE = .3;

// The foreground feathers are deliberately enlarged for readable barbs.
export const FEATHER_SCALE = .35;
export const FEATHER_FALL_SPEED = .42;
// Compress the falling field horizontally without changing feather sizes.
export const FEATHER_SPREAD = .25;

export const FOCUS_BAND = Object.freeze({ near: 2, far: 3 });
