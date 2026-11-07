import {
  DURATION as LAYER_SECONDS,
  SHAPES,
  SHAPE_OFFSET,
  mod,
} from "../journey.js";

export const FPS = 30;
export const SIZE = 1024;
export const CYCLE_LENGTH = SHAPES.length;
export const DURATION = CYCLE_LENGTH * LAYER_SECONDS;
export const FRAMES_PER_SHAPE = LAYER_SECONDS * FPS;
export const TOTAL_FRAMES = DURATION * FPS;
export const WARMUP_FRAMES = 64;

export const SHOTS = SHAPES.map((_, index) => ({
  shape: SHAPES[mod(index + SHAPE_OFFSET, CYCLE_LENGTH)],
  start: index * LAYER_SECONDS,
  startFrame: index * FRAMES_PER_SHAPE,
  frames: FRAMES_PER_SHAPE,
}));

export function frameAt(frame) {
  // Start in an established cycle, with the previous shell already present.
  // Absolute IDs continue through the end; only appearances and orbit repeat.
  return {
    frame,
    time: frame / FPS,
    depth: CYCLE_LENGTH + frame / FRAMES_PER_SHAPE,
    shape: SHOTS[mod(Math.floor(frame / FRAMES_PER_SHAPE), CYCLE_LENGTH)].shape,
  };
}
