export const FPS = 30;
export const SIZE = 1024;
export const SHOT_DURATION = 6;

// Follow the app's view order, then revisit two schools later in the simulation.
export const SHOTS = [
  "Observatory",
  "Amber school",
  "Azure school",
  "Green school",
  "Yellow school",
  "Across the dais",
  "Through the columns",
  "Terrace overlook",
  "Amber school",
  "Azure school",
].map((name, index) => ({
  name,
  start: index * SHOT_DURATION,
  end: (index + 1) * SHOT_DURATION,
  startFrame: index * SHOT_DURATION * FPS,
  frames: SHOT_DURATION * FPS,
}));

export const DURATION = SHOTS.length * SHOT_DURATION;
export const TOTAL_FRAMES = DURATION * FPS;

export function frameAt(frame) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= TOTAL_FRAMES)
    throw new RangeError("Frame must be within the capture sequence");
  const index = Math.floor(frame / (SHOT_DURATION * FPS));
  return { frame, time: frame / FPS, index, shot: SHOTS[index] };
}
