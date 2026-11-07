export const TAU = Math.PI * 2;
export const PINION_TEETH = 16;
export const PLANETS = Object.freeze([
  {
    name: "Mercury",
    teeth: 32,
    orbit: 1.15,
    radius: 0.24,
    phase: 2.36,
    height: 5.4,
  },
  {
    name: "Earth",
    teeth: 60,
    orbit: 1.9,
    radius: 0.25,
    phase: 2.2,
    height: 5.89,
  },
  {
    name: "Mars",
    teeth: 80,
    orbit: 2.44,
    radius: 0.23,
    phase: 5.85,
    height: 5.87,
  },
  {
    name: "Jupiter",
    teeth: 104,
    orbit: 3.05,
    radius: 0.32,
    phase: 2.62,
    height: 5.93,
  },
  {
    name: "Saturn",
    teeth: 136,
    orbit: 4.16,
    radius: 0.49,
    phase: 2.7,
    height: 5.44,
  },
]);

export function orbitAngle(index, clock) {
  const p = PLANETS[index];
  return p.phase + (clock * PINION_TEETH) / p.teeth;
}

export function wrappedDelta(current, previous) {
  return Math.atan2(
    Math.sin(current - previous),
    Math.cos(current - previous),
  );
}

// Integrate an exponentially decaying release impulse analytically, so winding
// settles identically at 30, 60 or 120 Hz. clock is the drive pinion's angle.
export class Clockwork {
  clock = 0;
  impulse = 0;
  releaseLag = 0;
  speed = 1;
  paused = false;
  dragging = false;
  targetClock = null;
  get windingClock() {
    return this.targetClock ?? this.clock;
  }
  beginTurn() {
    this.dragging = true;
    this.targetClock = this.clock;
    this.impulse = 0;
    this.releaseLag = 0;
  }
  endTurn(cancelled = false) {
    this.dragging = false;
    if (cancelled) {
      this.targetClock = null;
      this.impulse = 0;
      this.releaseLag = 0;
    }
  }
  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("advance expects finite, nonnegative seconds.");
    // Ease the shared drive, keeping every carrier mechanically coupled.
    // Manual winding can settle while paused; the automatic drive stays still.
    if (this.targetClock !== null) {
      this.clock += (this.targetClock - this.clock) * -Math.expm1(-5 * dt);
      if (
        !this.dragging &&
        Math.abs(this.targetClock - this.clock) < 0.00001
      ) {
        this.clock = this.targetClock;
        this.targetClock = null;
      }
    }
    if (this.paused || this.dragging) return;
    const decay = Math.exp(-2.4 * dt);
    const ease = Math.exp(-5 * dt);
    const drive =
      this.speed * dt +
      (this.impulse * (1 - decay)) / 2.4 -
      (this.releaseLag * (1 - ease)) / 5;
    this.clock += drive;
    if (this.targetClock !== null) this.targetClock += drive;
    this.impulse *= decay;
    this.releaseLag *= ease;
  }
  turn(index, angle) {
    const delta = (angle * PLANETS[index].teeth) / PINION_TEETH;
    if (this.targetClock !== null) this.targetClock += delta;
    else this.clock += delta;
  }
  release(velocity) {
    this.impulse = Math.max(-12, Math.min(12, velocity));
    this.releaseLag = this.impulse;
  }
  reset() {
    this.clock = 0;
    this.impulse = 0;
    this.releaseLag = 0;
    this.targetClock = null;
    this.dragging = false;
  }
}
