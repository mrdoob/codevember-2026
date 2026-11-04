export const HEAT_RADIUS = 1;
export const FIRE_VISUAL_RADIUS = .2;
export const HEAT_FALLOFF = .5;
export const HEAT_DURATION = 5;

// Travel follows simulation time, so pause, reset and time scale also control
// the source. Finish when the bottom of the sphere touches the studio floor.
export function heatSourceHeight(top, time, radius = HEAT_RADIUS, duration = HEAT_DURATION) {
  const start = top + radius + HEAT_FALLOFF * .5;
  const progress = Math.max(0, Math.min(1, time / duration));
  return start + (FIRE_VISUAL_RADIUS - .07 - start) * progress;
}
