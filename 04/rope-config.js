// Shared dimensions, limits, and defaults for both simulation backends.
export const STEP = 1 / 120;
export const SPACING = 0.09;
export const RADIUS = 0.057;
export const STRANDS = 5;
export const CAPACITY = 720;
export const GPU_CAPACITY = 2160;
export const INITIAL_COUNT = 40;
export const INLET_HEIGHT = 5.6;
export const INLET_RADIUS = 1.45;
export const INLET_SPEED = 0.25;

export const DEFAULT_PHYSICS = Object.freeze({
  feed: 1.35,
  wander: 1,
  softness: 0.65,
  friction: 0.85
});
