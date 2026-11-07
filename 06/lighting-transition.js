// Analytic critically damped motion: continuous when reversed mid-transition
// and independent of frame rate. Lighting can change while the clock is paused.
export class DaylightTransition {
  constructor(value = 1) {
    this.value = this.target = value;
    this.velocity = 0;
  }
  get active() {
    return this.value !== this.target || this.velocity !== 0;
  }
  setTarget(value, instant = false) {
    this.target = Math.max(0, Math.min(1, value));
    if (instant) {
      this.value = this.target;
      this.velocity = 0;
    }
  }
  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("Invalid transition timestep.");
    if (!this.active) return;
    const omega = 4.5,
      error = this.value - this.target;
    const c = this.velocity + omega * error,
      decay = Math.exp(-omega * dt);
    this.value = this.target + (error + c * dt) * decay;
    this.velocity = (this.velocity - omega * c * dt) * decay;
    if (
      Math.abs(this.value - this.target) < 0.0001 &&
      Math.abs(this.velocity) < 0.001
    ) {
      this.value = this.target;
      this.velocity = 0;
    }
  }
}
