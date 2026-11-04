// Render at display cadence and native pixel density. Only the numerical
// solver has a maximum step; a long stall never creates a catch-up backlog.
export const MAX_SOLVER_STEP = 1 / 60;
export const MAX_FRAME_DELTA = .1;
export function drawingSize(width, height, quality = 1, pixelRatio = 1) {
  if (![width, height, quality, pixelRatio].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid viewport');
  const scale = quality * pixelRatio;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function simulationStep(seconds, remainder = 0) {
  const elapsed = Number.isFinite(seconds) ? Math.max(0, Math.min(MAX_FRAME_DELTA, seconds)) : 0;
  const accumulated = Math.max(0, remainder) + elapsed;
  const steps = Math.floor((accumulated + 1e-10) / MAX_SOLVER_STEP);
  return { elapsed, steps, dt: steps ? MAX_SOLVER_STEP : 0, remainder: Math.max(0, accumulated - steps * MAX_SOLVER_STEP) };
}
