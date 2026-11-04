import {
  STEP,
  SPACING,
  RADIUS,
  STRANDS,
  CAPACITY,
  INITIAL_COUNT,
  INLET_HEIGHT,
  DEFAULT_PHYSICS
} from './rope-config.js';

// Fixed-step position-based ropes. Particle contact is an approximation to
// continuous strand collision; the sample spacing is smaller than the diameter.
export class RopeSimulation {
  constructor({ strands = STRANDS, count = CAPACITY } = {}) {
    this.engine = 'CPU';
    this.strands = strands;
    this.count = count;
    this.total = strands * count;
    this.initialCount = Math.min(count, INITIAL_COUNT);
    this.active = new Uint32Array(strands);
    this.positions = new Float64Array(this.total * 3);
    this.previous = new Float64Array(this.total * 3);
    this.velocity = new Float64Array(this.total * 3);
    this.weights = new Float64Array(this.total);
    this.phase = new Float64Array(strands);
    this.travel = new Float64Array(strands);
    this.heads = new Int32Array(8192);
    this.next = new Int32Array(this.total);
    this.cells = new Int32Array(this.total * 3);
    this.lambda = new Float64Array(this.total);
    this.floorLoad = new Float64Array(this.total);
    this.settings = { ...DEFAULT_PHYSICS };
    this.reset();
  }

  inlet(strand, time, out = [0, 0, 0]) {
    const a = (strand * Math.PI * 2) / this.strands;
    const t = time * this.settings.wander;
    out[0] = 1.45 * Math.cos(a + t * 0.23) + 0.48 * Math.sin(t * 0.71 + a * 2);
    out[1] = INLET_HEIGHT;
    out[2] = 1.05 * Math.sin(a + t * 0.29) + 0.38 * Math.sin(t * 0.53 + a);
    return out;
  }

  reset() {
    this.time = 0;
    this.accumulator = 0;
    this.grab = null;
    this.phase.fill(SPACING);
    this.travel.fill(0);
    this.velocity.fill(0);
    this.weights.fill(0);
    this.active.fill(this.initialCount);
    const p = this.positions;
    for (let s = 0; s < this.strands; s++) {
      const a = this.inlet(s, 0);
      for (let n = 0; n < this.count; n++) {
        const index = s * this.count + n,
          i = index * 3,
          live = n < this.initialCount;
        p[i] = a[0];
        p[i + 1] = a[1] - (live ? n * SPACING : 0);
        p[i + 2] = a[2];
        this.weights[index] = live && n > 0 ? 1 : 0;
      }
    }
    this.previous.set(p);
  }

  isActive(index) {
    return index % this.count < this.active[Math.floor(index / this.count)];
  }

  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0) return 0;
    this.accumulator += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accumulator >= STEP - 1e-10) {
      this.step();
      this.accumulator -= STEP;
      steps++;
    }
    return steps;
  }

  feed() {
    const p = this.positions,
      v = this.velocity;
    for (let s = 0; s < this.strands; s++) {
      const start = s * this.count;
      const a = this.inlet(s, this.time);
      this.phase[s] += this.settings.feed * STEP;
      while (this.phase[s] > SPACING * 2) {
        const live = Math.min(this.count, this.active[s] + 1),
          end = start + live;
        p.copyWithin((start + 1) * 3, start * 3, (end - 1) * 3);
        v.copyWithin((start + 1) * 3, start * 3, (end - 1) * 3);
        this.active[s] = live;
        this.weights[end - 1] = 1;
        this.phase[s] -= SPACING;
        this.travel[s] += SPACING;
        if (this.grab && Math.floor(this.grab.index / this.count) === s) {
          this.grab.index++;
          if (this.grab.index >= end - 3) this.endGrab();
        }
      }
      p.set(a, start * 3);
      v.fill(0, start * 3, start * 3 + 3);
    }
  }

  step(feeding = true) {
    if (feeding) {
      this.time += STEP;
      this.feed();
    }
    const p = this.positions,
      prev = this.previous,
      v = this.velocity,
      w = this.weights;
    prev.set(p);
    for (let i = 0; i < this.total; i++) {
      if (!w[i]) continue;
      const j = i * 3;
      v[j] *= 0.997;
      v[j + 1] = v[j + 1] * 0.997 - 9.81 * STEP;
      v[j + 2] *= 0.997;
      p[j] += v[j] * STEP;
      p[j + 1] += v[j + 1] * STEP;
      p[j + 2] += v[j + 2] * STEP;
    }
    this.lambda.fill(0);
    this.floorLoad.fill(0);
    for (let it = 0; it < 8; it++) {
      this.bend();
      this.stretch(it % 2 === 0);
      this.applyGrab();
      if (it % 2 === 1) this.contact();
      this.floor();
    }
    for (let i = 0; i < this.total; i++) {
      if (!this.isActive(i)) continue;
      const j = i * 3;
      for (let k = 0; k < 3; k++) v[j + k] = Math.max(-18, Math.min(18, (p[j + k] - prev[j + k]) / STEP));
      if (p[j + 1] <= RADIUS + 0.005) {
        const friction = 1 - this.settings.friction * 0.16;
        v[j] *= friction;
        v[j + 2] *= friction;
        v[j + 1] = Math.max(0, v[j + 1]) * 0.15;
      }
    }
  }

  stretch(forward) {
    const p = this.positions,
      w = this.weights;
    const alpha = 0.0000003 / (STEP * STEP);
    for (let s = 0; s < this.strands; s++) {
      const start = s * this.count;
      const live = this.active[s];
      for (let n = 0; n < live - 1; n++) {
        const a = start + (forward ? n : live - 2 - n),
          b = a + 1;
        const i = a * 3,
          j = b * 3;
        const x = p[j] - p[i],
          y = p[j + 1] - p[i + 1],
          z = p[j + 2] - p[i + 2];
        const length = Math.sqrt(x * x + y * y + z * z) || 1e-9;
        const rest = a === start ? this.phase[s] : SPACING;
        const dl = (length - rest + alpha * this.lambda[a]) / (w[a] + w[b] + alpha);
        this.lambda[a] -= dl;
        const factor = dl / length;
        const da = factor * w[a],
          db = factor * w[b];
        p[i] += x * da;
        p[i + 1] += y * da;
        p[i + 2] += z * da;
        p[j] -= x * db;
        p[j + 1] -= y * db;
        p[j + 2] -= z * db;
      }
    }
  }

  bend() {
    const p = this.positions,
      w = this.weights;
    const strength = 0.016 + (1 - this.settings.softness) * 0.07;
    for (let s = 0; s < this.strands; s++) {
      const end = s * this.count + this.active[s] - 2;
      for (let a = s * this.count + 1; a < end; a++) {
        const b = a + 2,
          i = a * 3,
          j = b * 3;
        const x = p[j] - p[i],
          y = p[j + 1] - p[i + 1],
          z = p[j + 2] - p[i + 2];
        const d = Math.sqrt(x * x + y * y + z * z);
        if (d < 1e-9) continue;
        const f = (((d - 2 * SPACING) / d) * strength) / (w[a] + w[b]);
        p[i] += x * f * w[a];
        p[i + 1] += y * f * w[a];
        p[i + 2] += z * f * w[a];
        p[j] -= x * f * w[b];
        p[j + 1] -= y * f * w[b];
        p[j + 2] -= z * f * w[b];
      }
    }
  }

  hash(x, y, z) {
    return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 8191;
  }

  contact() {
    const p = this.positions,
      w = this.weights,
      c = this.cells,
      heads = this.heads,
      next = this.next;
    const diameter = RADIUS * 2,
      d2 = diameter * diameter,
      inverse = 1 / diameter;
    const previous = this.previous,
      staticGrip = this.settings.friction * 0.7,
      slidingGrip = this.settings.friction * 0.45;
    heads.fill(-1);
    for (let a = 0; a < this.total; a++) {
      if (!this.isActive(a)) continue;
      const i = a * 3;
      const x = (c[i] = Math.floor(p[i] * inverse)),
        y = (c[i + 1] = Math.floor(p[i + 1] * inverse)),
        z = (c[i + 2] = Math.floor(p[i + 2] * inverse));
      const key = this.hash(x, y, z);
      next[a] = heads[key];
      heads[key] = a;
    }
    for (let a = 0; a < this.total; a++) {
      if (!this.isActive(a)) continue;
      const i = a * 3,
        sx = c[i],
        sy = c[i + 1],
        sz = c[i + 2];
      const strand = Math.floor(a / this.count);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++)
          for (let oz = -1; oz <= 1; oz++) {
            const cx = sx + ox,
              cy = sy + oy,
              cz = sz + oz;
            for (let b = heads[this.hash(cx, cy, cz)]; b !== -1; b = next[b]) {
              if (b <= a || (b - a <= 2 && Math.floor(b / this.count) === strand)) continue;
              const j = b * 3;
              if (c[j] !== cx || c[j + 1] !== cy || c[j + 2] !== cz) continue;
              let x = p[j] - p[i],
                y = p[j + 1] - p[i + 1],
                z = p[j + 2] - p[i + 2];
              const squared = x * x + y * y + z * z;
              if (squared >= d2 || w[a] + w[b] === 0) continue;
              let distance = Math.sqrt(squared);
              if (distance < 1e-8) {
                x = 0.0001;
                y = 0;
                z = 0;
                distance = 0.0001;
              }
              const factor = (((diameter - distance) / distance) * 0.9) / (w[a] + w[b]);
              const aa = factor * w[a],
                bb = factor * w[b];
              p[i] -= x * aa;
              p[i + 1] -= y * aa;
              p[i + 2] -= z * aa;
              p[j] += x * bb;
              p[j + 1] += y * bb;
              p[j + 2] += z * bb;
              // Friction acts on relative displacement inside the solver. Merely
              // damping velocity leaves the position corrections free to creep.
              const nx = x / distance,
                ny = y / distance,
                nz = z / distance;
              const dx = p[i] - previous[i] - p[j] + previous[j];
              const dy = p[i + 1] - previous[i + 1] - p[j + 1] + previous[j + 1];
              const dz = p[i + 2] - previous[i + 2] - p[j + 2] + previous[j + 2];
              const normalMotion = dx * nx + dy * ny + dz * nz;
              const tx = dx - nx * normalMotion,
                ty = dy - ny * normalMotion,
                tz = dz - nz * normalMotion;
              const slip = Math.sqrt(tx * tx + ty * ty + tz * tz);
              if (slip > 1e-10 && staticGrip > 0) {
                const load = (diameter - distance) * 0.9;
                const grip = slip <= staticGrip * load ? 1 : Math.min(1, (slidingGrip * load) / slip);
                const fa = (grip * w[a]) / (w[a] + w[b]),
                  fb = (grip * w[b]) / (w[a] + w[b]);
                p[i] -= tx * fa;
                p[i + 1] -= ty * fa;
                p[i + 2] -= tz * fa;
                p[j] += tx * fb;
                p[j + 1] += ty * fb;
                p[j + 2] += tz * fb;
              }
            }
          }
    }
  }

  floor() {
    const p = this.positions,
      previous = this.previous;
    const staticGrip = this.settings.friction * 1.8,
      slidingGrip = this.settings.friction * 1.2;
    for (let a = 0; a < this.total; a++) {
      if (!this.isActive(a)) continue;
      const i = a * 3;
      if (p[i + 1] <= RADIUS) {
        this.floorLoad[a] += RADIUS - p[i + 1];
        const dx = p[i] - previous[i],
          dz = p[i + 2] - previous[i + 2],
          slip = Math.hypot(dx, dz);
        if (slip > 1e-10 && staticGrip > 0) {
          const grip =
            slip <= staticGrip * this.floorLoad[a] ? 1 : Math.min(1, (slidingGrip * this.floorLoad[a]) / slip);
          p[i] -= dx * grip;
          p[i + 2] -= dz * grip;
        }
      }
      p[i + 1] = Math.max(RADIUS, Math.min(7.5, p[i + 1]));
      p[i] = Math.max(-6.8, Math.min(6.8, p[i]));
      p[i + 2] = Math.max(-6.8, Math.min(6.8, p[i + 2]));
    }
  }

  beginGrab(index, target) {
    const n = index % this.count;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.total ||
      n < 4 ||
      n > this.active[Math.floor(index / this.count)] - 4
    )
      return false;
    this.grab = { index, target: Array.from(target) };
    return true;
  }
  moveGrab(target) {
    if (this.grab) this.grab.target = Array.from(target);
  }
  endGrab() {
    this.grab = null;
  }
  applyGrab() {
    if (!this.grab) return;
    const { index, target } = this.grab,
      p = this.positions;
    // A small soft patch spreads the pull over the yarn instead of forming a
    // sharp kink at a single particle. Bound corrections to avoid teleporting.
    const center = index * 3;
    let x = target[0] - p[center],
      y = target[1] - p[center + 1],
      z = target[2] - p[center + 2];
    const length = Math.hypot(x, y, z),
      factor = Math.min(1, 0.1 / (length || 1));
    x *= factor;
    y *= factor;
    z *= factor;
    for (let n = -3; n <= 3; n++) {
      const a = index + n,
        j = a * 3,
        weight = 0.38 * Math.exp(-n * n * 0.28);
      if (!this.weights[a]) continue;
      p[j] += x * weight;
      p[j + 1] += y * weight;
      p[j + 2] += z * weight;
    }
  }

  inspect() {
    let minY = Infinity,
      maxY = -Infinity,
      maxStretch = 0,
      sumStretch = 0;
    for (let i = 0; i < this.total; i++) {
      if (!this.isActive(i)) continue;
      const j = i * 3;
      minY = Math.min(minY, this.positions[j + 1]);
      maxY = Math.max(maxY, this.positions[j + 1]);
      if (i % this.count < 2) continue;
      const d = Math.hypot(
        this.positions[j] - this.positions[j - 3],
        this.positions[j + 1] - this.positions[j - 2],
        this.positions[j + 2] - this.positions[j - 1]
      );
      const e = Math.abs(d / SPACING - 1);
      maxStretch = Math.max(maxStretch, e);
      sumStretch += e;
    }
    const particles = this.active.reduce((sum, count) => sum + count, 0);
    return {
      time: this.time,
      particles,
      capacity: this.total,
      finite: this.positions.every(Number.isFinite),
      minY,
      maxY,
      maxStretch,
      meanStretch: sumStretch / Math.max(1, particles - this.strands * 2)
    };
  }
}
