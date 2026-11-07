export const RATIO = 0.34;
export const DURATION = 6;
export const BASE_SCALE = 1.65;
export const SHELL_BOUND = 1.35;
export const SPLIT_DISTANCE = 2.3;
// Opening, drift, and lifetime use layer units (one layer is DURATION seconds).
export const SPLIT_SLOWDOWN = 6;
export const SPLIT_TIME = 0.14 * SPLIT_SLOWDOWN;
export const OPEN_START = 0;
export const SHELL_LIFETIME = 2;
export const FADE_START = 1.45;
export const MAX_HINGE_TILT = 0.3;
export const OPEN_SHELL_BOUND = SHELL_BOUND * (1 + MAX_HINGE_TILT);
export const SHAPE_OFFSET = 2;
export const SPIN_RATE = 1.8;
export const DRIFT_SPEED = 1.1;
export const MIN_SPLIT_TILT = 0.52;
export const MAX_SPLIT_TILT = 0.58;
export const SHAPES = [
  "Cube",
  "Triangular prism",
  "Hexagonal bipyramid",
  "Icosahedron",
  "Barrel",
  "Hexagonal prism",
  "Dodecahedron",
  "Octahedron",
  "Cylinder",
  "Capsule",
  "Sphere",
];
export const mod = (x, n) => ((x % n) + n) % n;
export function seeded(id, salt) {
  let h = Math.imul(id + salt, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const ease = (t) => {
  const u = Math.max(0, Math.min(t, 1));
  return u * u * (3 - 2 * u);
};
const drift = (t) => {
  const u = Math.max(0, t);
  return u - 0.08 * (1 - Math.exp(-u / 0.08));
};

// A full-period integer hue permutation avoids the short repeating palette.
// The golden-angle step separates neighbouring reveals; other permutations
// vary saturation and lightness. No growing history or material cache.
export function liningColor(id) {
  const unit = (multiplier) => (Math.imul(id, multiplier) >>> 0) / 4294967296;
  return {
    h: ((Math.imul(id, 2654435761) + 2863311530) >>> 0) / 4294967296,
    s: 0.78 + unit(1597334677) * 0.14,
    l: 0.4 + unit(3812015801) * 0.08,
  };
}

// Only the fractional journey is exponentiated. Every boundary promotes the
// inner shell to unit size, so neither transforms nor near/far planes drift.
export function layerState(index, phase, offset, cycleLength = 0) {
  const id = index + offset;
  // Capture can repeat appearances while IDs and relative ages keep advancing.
  const seed = cycleLength > 0 ? mod(id, cycleLength) : id;
  const age = phase - offset;
  // Opening is elapsed time, not progress toward a stopped end pose.
  const opening = Math.max(0, age - OPEN_START);
  const departureTime = opening / SPLIT_SLOWDOWN;
  return {
    id,
    seed,
    shape: mod(id + SHAPE_OFFSET, SHAPES.length),
    color: seed,
    age,
    scale: BASE_SCALE * RATIO ** (offset - phase),
    opening,
    departureTime,
    hinge: MAX_HINGE_TILT * ease(opening / SPLIT_TIME),
    fade: ease((age - FADE_START) / (SHELL_LIFETIME - FADE_START)),
    // One eased departure with a continuous outward velocity; no second
    // stage, change of heading, or pause before the ongoing drift.
    separation:
      DRIFT_SPEED * drift(departureTime) +
      (SPLIT_DISTANCE - DRIFT_SPEED * drift(SPLIT_TIME / SPLIT_SLOWDOWN)) *
        ease(opening / SPLIT_TIME),
    spin: -age * SPIN_RATE,
    // The cut stays oblique to the camera. A small, signed depth tilt leaves
    // the seam readable while its fixed normal points mostly across screen.
    bearing: seeded(seed, 701) * Math.PI * 2,
    tilt:
      (MIN_SPLIT_TILT + seeded(seed, 313) * (MAX_SPLIT_TILT - MIN_SPLIT_TILT)) *
      (seeded(seed, 967) < 0.5 ? -1 : 1),
    spinOffset: seeded(seed, 173) * Math.PI * 2,
  };
}

export class Journey {
  constructor() {
    this.index = 0;
    this.phase = 0;
    this.speed = 1;
    this.paused = false;
  }
  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("Time step must be finite and nonnegative.");
    if (this.paused) return;
    const phase = this.phase + (dt * this.speed) / DURATION;
    const steps = Math.floor(phase);
    this.index += steps;
    this.phase = phase - steps;
  }
  seek(depth) {
    if (
      !Number.isFinite(depth) ||
      depth < 0 ||
      depth > Number.MAX_SAFE_INTEGER - 4
    )
      throw new RangeError("Invalid depth.");
    this.index = Math.floor(depth);
    this.phase = depth - this.index;
  }
  reset() {
    this.seek(0);
  }
  get depth() {
    return this.index + this.phase;
  }
}
