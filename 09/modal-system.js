import { BASIS, basisShape, SURFACE_DENSITY } from "./modes.js";
export const GRAVITY = 9.81;
export const DRIVER = { x: 0.047, z: 0.031, radius: 0.009 };

// q'' + 2 ζ ω q' + ω²q = (F_driver φ_driver + F_gravity)/M.
// Exact damped homogeneous propagation; midpoint, piecewise-constant forcing.
export class ModalSystem {
  constructor({ step = 1 / 9600, damping = 0.008, gravity = GRAVITY } = {}) {
    this.step = step;
    this.damping = damping;
    const count = BASIS.length;
    this.q = new Float64Array(count);
    this.v = new Float64Array(count);
    this.acceleration = new Float64Array(count);
    this.gravityForce = new Float64Array(count);
    this.coupling = new Float64Array(count);
    this.matrix = new Float64Array(count * 4);
    for (let i = 0; i < count; i++) {
      const mode = BASIS[i],
        w = mode.omega,
        d = damping * w,
        wd = Math.sqrt(w * w - d * d);
      const e = Math.exp(-d * step),
        c = Math.cos(wd * step),
        s = Math.sin(wd * step) / wd;
      this.matrix.set(
        [e * (c + d * s), e * s, -e * w * w * s, e * (c - d * s)],
        i * 4,
      );
      this.gravityForce[i] = -SURFACE_DENSITY * gravity * mode.integral;
      let sum = 0,
        weight = 0;
      for (let r = 0; r < 8; r++)
        for (let a = 0; a < 24; a++) {
          const radius = ((r + 0.5) / 8) * DRIVER.radius * 3,
            theta = ((a + 0.5) / 24) * Math.PI * 2;
          const dw =
            radius * Math.exp((-radius * radius) / (2 * DRIVER.radius ** 2));
          sum +=
            dw *
            basisShape(
              i,
              DRIVER.x + radius * Math.cos(theta),
              DRIVER.z + radius * Math.sin(theta),
            );
          weight += dw;
        }
      this.coupling[i] = sum / weight;
    }
    this.reset();
  }
  reset() {
    this.v.fill(0);
    this.acceleration.fill(0);
    for (let i = 0; i < BASIS.length; i++)
      this.q[i] = this.gravityForce[i] / (BASIS[i].mass * BASIS[i].omega ** 2);
  }
  advance(force) {
    const q = this.q,
      v = this.v,
      a = this.acceleration,
      m = this.matrix;
    for (let i = 0; i < BASIS.length; i++) {
      const mode = BASIS[i],
        equilibrium =
          (force * this.coupling[i] + this.gravityForce[i]) /
          (mode.mass * mode.omega ** 2);
      const x = q[i] - equilibrium,
        oldV = v[i],
        k = i * 4;
      q[i] = equilibrium + m[k] * x + m[k + 1] * oldV;
      v[i] = m[k + 2] * x + m[k + 3] * oldV;
      a[i] =
        (force * this.coupling[i] + this.gravityForce[i]) / mode.mass -
        2 * this.damping * mode.omega * v[i] -
        mode.omega ** 2 * q[i];
    }
  }
  impulse(x, z, impulse) {
    for (let i = 0; i < BASIS.length; i++)
      this.v[i] += (basisShape(i, x, z) * impulse) / BASIS[i].mass;
  }
  get energy() {
    let sum = 0;
    for (let i = 0; i < BASIS.length; i++) {
      const mode = BASIS[i],
        x = this.q[i] - this.gravityForce[i] / (mode.mass * mode.omega ** 2);
      sum += 0.5 * mode.mass * (this.v[i] ** 2 + mode.omega ** 2 * x * x);
    }
    return sum;
  }
}
