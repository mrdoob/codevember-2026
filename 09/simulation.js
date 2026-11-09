import {
  RADIUS,
  PHYSICAL_RADIUS,
  WORLD_SCALE,
  REST_HEIGHT,
  MODES,
  BASIS,
  basisShape,
  modeFrequency,
  randomGenerator,
} from "./modes.js";
import { ModalSystem, GRAVITY } from "./modal-system.js";

export const GRID = 145;
export const PHYSICS_STEP = 1 / 4800;
const COUNT = BASIS.length,
  CELL = (2 * PHYSICAL_RADIUS) / (GRID - 1);
const MAX_RADIUS = 0.00065,
  HASH_CELL = 2 * MAX_RADIUS,
  HASH_SIZE = 1 << 15;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (x, z) =>
  ((Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0) & (HASH_SIZE - 1);

// Rigid spherical grains on a tensioned membrane. No nodal attraction, random
// agitation, prescribed hops or displacement magnification are applied.
export class MembraneSimulation {
  constructor({
    grainCount = 1400,
    seed = 901,
    step = PHYSICS_STEP,
    gravity = GRAVITY,
    collisions = true,
    radiusScale = 1,
  } = {}) {
    this.grainCount = grainCount;
    this.radiusScale = radiusScale;
    this.seed = seed;
    this.step = step;
    this.gravity = gravity;
    this.collisions = collisions;
    this.auto = true;
    this.speed = 1;
    this.drive = 0.12;
    this.friction = 0.32;
    this.restitution = 0.35;
    this.rollingFriction = 0.025;
    this.modal = new ModalSystem({ step, gravity });
    this.p = new Float64Array(grainCount * 3);
    this.velocities = new Float64Array(grainCount * 3);
    this.spin = new Float64Array(grainCount * 3);
    this.radii = new Float64Array(grainCount);
    this.masses = new Float64Array(grainCount);
    this.positions = new Float32Array(grainCount * 3);
    this.sizes = new Float32Array(grainCount);
    this.seeds = new Float32Array(grainCount);
    this.orientations = new Float32Array(grainCount * 4);
    this.height = new Float32Array(GRID * GRID);
    this.fields = new Float32Array(GRID * GRID * COUNT);
    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++)
        for (let m = 0; m < COUNT; m++)
          this.fields[(j * GRID + i) * COUNT + m] = basisShape(
            m,
            i * CELL - PHYSICAL_RADIUS,
            j * CELL - PHYSICAL_RADIUS,
          );
    this.phi = new Float32Array(grainCount * COUNT);
    this.dx = new Float32Array(grainCount * COUNT);
    this.dz = new Float32Array(grainCount * COUNT);
    this.cacheX = new Float64Array(grainCount);
    this.cacheZ = new Float64Array(grainCount);
    this.inverseSurfaceMass = new Float64Array(grainCount);
    this.reaction = new Float64Array(COUNT);
    this.heads = new Int32Array(HASH_SIZE);
    this.links = new Int32Array(grainCount);
    this.cellX = new Int32Array(grainCount);
    this.cellZ = new Int32Array(grainCount);
    this.pickup = Float64Array.from(BASIS, (_, i) =>
      basisShape(i, 0.061, -0.037),
    );
    this.audioSamples = new Float32Array(0);
    this.reset();
  }
  get frequency() {
    return this.driveFrequency;
  }
  set frequency(value) {
    if (!Number.isFinite(value) || value < 40 || value > 300)
      throw new RangeError("Drive frequency must be 40–300 Hz.");
    this.driveFrequency = value;
  }
  selectMode(index) {
    if (!Number.isInteger(index) || index < 0 || index >= MODES.length)
      throw new RangeError("Unknown membrane mode.");
    this.mode = index;
    this.frequency = modeFrequency(index);
    this.nextAt = this.time + 120;
  }
  next() {
    this.selectMode((this.mode + 1) % MODES.length);
  }
  scatter() {
    const random = randomGenerator(this.seed),
      p = this.p;
    this.velocities.fill(0);
    this.spin.fill(0);
    this.cacheX.fill(Infinity);
    // Rejection sampling produces an initially non-overlapping monolayer.
    this.heads.fill(-1);
    for (let i = 0; i < this.grainCount; i++) {
      const radius = (0.0004 + random() * 0.00025) * this.radiusScale;
      this.radii[i] = radius;
      this.sizes[i] = radius * WORLD_SCALE;
      this.masses[i] = (4 / 3) * Math.PI * radius ** 3 * 2650;
      this.seeds[i] = random() * Math.PI * 2;
      let x, z, cx, cz, overlap;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const r = Math.sqrt(random()) * (PHYSICAL_RADIUS - radius * 2),
          a = random() * Math.PI * 2;
        x = r * Math.cos(a);
        z = r * Math.sin(a);
        cx = Math.floor(x / HASH_CELL);
        cz = Math.floor(z / HASH_CELL);
        overlap = false;
        for (let oz = -1; oz <= 1; oz++)
          for (let ox = -1; ox <= 1; ox++)
            for (
              let j = this.heads[hash(cx + ox, cz + oz)];
              j !== -1;
              j = this.links[j]
            ) {
              if (this.cellX[j] !== cx + ox || this.cellZ[j] !== cz + oz)
                continue;
              if (
                (p[j * 3] - x) ** 2 + (p[j * 3 + 2] - z) ** 2 <
                (this.radii[j] + radius) ** 2
              )
                overlap = true;
            }
        if (!overlap) break;
      }
      p[i * 3] = x;
      p[i * 3 + 2] = z;
      this.cacheGrain(i);
      let h = 0;
      for (let m = 0; m < COUNT; m++)
        h += this.phi[i * COUNT + m] * this.modal.q[m];
      p[i * 3 + 1] = h + radius + 0.00003;
      this.cellX[i] = cx;
      this.cellZ[i] = cz;
      const key = hash(cx, cz);
      this.links[i] = this.heads[key];
      this.heads[key] = i;
      const u = random(),
        a = random() * Math.PI * 2,
        b = random() * Math.PI * 2;
      this.orientations.set(
        [
          Math.sqrt(1 - u) * Math.sin(a),
          Math.sqrt(1 - u) * Math.cos(a),
          Math.sqrt(u) * Math.sin(b),
          Math.sqrt(u) * Math.cos(b),
        ],
        i * 4,
      );
    }
    this.syncRenderState(0);
  }
  cacheGrain(i) {
    const x = this.p[i * 3],
      z = this.p[i * 3 + 2];
    const u = clamp((x + PHYSICAL_RADIUS) / CELL, 0, GRID - 1.000001),
      v = clamp((z + PHYSICAL_RADIUS) / CELL, 0, GRID - 1.000001);
    const ix = Math.floor(u),
      iz = Math.floor(v),
      a = u - ix,
      b = v - iz,
      k = (iz * GRID + ix) * COUNT,
      offset = i * COUNT,
      f = this.fields;
    let inv = 0;
    for (let m = 0; m < COUNT; m++) {
      const f00 = f[k + m],
        f10 = f[k + COUNT + m],
        f01 = f[k + GRID * COUNT + m],
        f11 = f[k + (GRID + 1) * COUNT + m];
      const value =
        (f00 * (1 - a) + f10 * a) * (1 - b) + (f01 * (1 - a) + f11 * a) * b;
      this.phi[offset + m] = value;
      this.dx[offset + m] = ((f10 - f00) * (1 - b) + (f11 - f01) * b) / CELL;
      this.dz[offset + m] = ((f01 - f00) * (1 - a) + (f11 - f10) * a) / CELL;
      inv += (value * value) / BASIS[m].mass;
    }
    this.inverseSurfaceMass[i] = inv;
    this.cacheX[i] = x;
    this.cacheZ[i] = z;
  }
  pluck(x, z, strength = 1) {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !Number.isFinite(strength) ||
      Math.hypot(x, z) > RADIUS * 0.98
    )
      return false;
    // A localized mechanical impulse changes modal momentum, never grain velocity.
    this.modal.impulse(
      x / WORLD_SCALE,
      z / WORLD_SCALE,
      -clamp(strength, 0, 2) * 0.0004,
    );
    return true;
  }
  stepGrains(dt) {
    const p = this.p,
      v = this.velocities,
      w = this.spin,
      q = this.modal.q,
      mv = this.modal.v;
    const phi = this.phi,
      gx = this.dx,
      gz = this.dz,
      reaction = this.reaction;
    reaction.fill(0);
    let ceiling = 0;
    for (let m = 0; m < COUNT; m++) ceiling += Math.abs(q[m]);
    const mu = this.friction,
      e = this.restitution;
    for (let i = 0; i < this.grainCount; i++) {
      const k = i * 3,
        r = this.radii[i];
      p[k] += v[k] * dt;
      p[k + 1] += v[k + 1] * dt - 0.5 * this.gravity * dt * dt;
      p[k + 2] += v[k + 2] * dt;
      v[k + 1] -= this.gravity * dt;
      // A vertical retaining rim. No artificial force towards the centre.
      const radial = Math.hypot(p[k], p[k + 2]),
        limit = PHYSICAL_RADIUS - r;
      if (radial > limit) {
        const nx = p[k] / radial,
          nz = p[k + 2] / radial,
          out = v[k] * nx + v[k + 2] * nz;
        p[k] = nx * limit;
        p[k + 2] = nz * limit;
        if (out > 0) {
          v[k] -= (1 + e) * out * nx;
          v[k + 2] -= (1 + e) * out * nz;
        }
      }
      if (p[k + 1] - r > ceiling + 0.000001) continue;
      let cx = p[k] - this.cacheX[i],
        cz = p[k + 2] - this.cacheZ[i];
      if (Math.abs(cx) + Math.abs(cz) > 0.00004) {
        this.cacheGrain(i);
        cx = cz = 0;
      }
      const offset = i * COUNT;
      let h = 0,
        sv = 0,
        sx = 0,
        sz = 0;
      for (let m = 0; m < COUNT; m++) {
        const index = offset + m,
          shape = phi[index] + gx[index] * cx + gz[index] * cz;
        h += shape * q[m];
        sv += shape * mv[m];
        sx += gx[index] * q[m];
        sz += gz[index] * q[m];
      }
      const invN = 1 / Math.sqrt(1 + sx * sx + sz * sz),
        nx = -sx * invN,
        ny = invN,
        nz = -sz * invN;
      const gap = (p[k + 1] - h) * ny - r;
      if (gap > 0) continue;
      p[k] -= gap * nx;
      p[k + 1] -= gap * ny;
      p[k + 2] -= gap * nz;
      const rvx = v[k],
        rvy = v[k + 1] - sv,
        rvz = v[k + 2];
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn >= 0) continue;
      const mass = this.masses[i],
        inverseMass = 1 / mass;
      // Resting contacts suppress restitution below the gravity step velocity.
      const restitution = vn < -this.gravity * dt * 3 ? e : 0;
      const jn =
        (-(1 + restitution) * vn) /
        (inverseMass + ny * ny * this.inverseSurfaceMass[i]);
      const tx = rvx - vn * nx - r * (w[k + 1] * nz - w[k + 2] * ny);
      const ty = rvy - vn * ny - r * (w[k + 2] * nx - w[k] * nz);
      const tz = rvz - vn * nz - r * (w[k] * ny - w[k + 1] * nx);
      const slip = Math.hypot(tx, ty, tz);
      const jt =
        slip > 1e-12 ? Math.min(mu * jn, (slip * mass) / 3.5) / slip : 0;
      const jx = jn * nx - jt * tx,
        jy = jn * ny - jt * ty,
        jz = jn * nz - jt * tz;
      v[k] += jx * inverseMass;
      v[k + 1] += jy * inverseMass;
      v[k + 2] += jz * inverseMass;
      const angular = 2.5 / (mass * r);
      w[k] -= angular * (ny * jz - nz * jy);
      w[k + 1] -= angular * (nz * jx - nx * jz);
      w[k + 2] -= angular * (nx * jy - ny * jx);
      // Coulomb rolling resistance, proportional to normal impulse and radius.
      const wn = w[k] * nx + w[k + 1] * ny + w[k + 2] * nz;
      const wx = w[k] - wn * nx,
        wy = w[k + 1] - wn * ny,
        wz = w[k + 2] - wn * nz,
        spin = Math.hypot(wx, wy, wz);
      const roll =
        spin > 0
          ? Math.min(1, (this.rollingFriction * jn * angular) / spin)
          : 0;
      w[k] -= wx * roll;
      w[k + 1] -= wy * roll;
      w[k + 2] -= wz * roll;
      // Equal and opposite vertical contact impulse goes back into the membrane.
      for (let m = 0; m < COUNT; m++)
        reaction[m] -=
          (jy * (phi[offset + m] + gx[offset + m] * cx + gz[offset + m] * cz)) /
          BASIS[m].mass;
    }
    for (let m = 0; m < COUNT; m++) mv[m] += reaction[m];
  }
  collideGrains() {
    const p = this.p,
      v = this.velocities,
      w = this.spin;
    this.heads.fill(-1);
    for (let i = 0; i < this.grainCount; i++) {
      const cx = Math.floor(p[i * 3] / HASH_CELL),
        cz = Math.floor(p[i * 3 + 2] / HASH_CELL),
        key = hash(cx, cz);
      this.cellX[i] = cx;
      this.cellZ[i] = cz;
      this.links[i] = this.heads[key];
      this.heads[key] = i;
    }
    for (let i = 0; i < this.grainCount; i++) {
      const k = i * 3,
        cx = this.cellX[i],
        cz = this.cellZ[i];
      for (let oz = 0; oz <= 1; oz++)
        for (let ox = oz === 0 ? 0 : -1; ox <= 1; ox++)
          for (
            let j = this.heads[hash(cx + ox, cz + oz)];
            j !== -1;
            j = this.links[j]
          ) {
            if (
              (ox === 0 && oz === 0 && j <= i) ||
              this.cellX[j] !== cx + ox ||
              this.cellZ[j] !== cz + oz
            )
              continue;
            const l = j * 3,
              ri = this.radii[i],
              rj = this.radii[j],
              r = ri + rj;
            const dx = p[k] - p[l],
              dy = p[k + 1] - p[l + 1],
              dz = p[k + 2] - p[l + 2],
              d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= r * r || d2 < 1e-24) continue;
            const d = Math.sqrt(d2),
              nx = dx / d,
              ny = dy / d,
              nz = dz / d;
            const mi = 1 / this.masses[i],
              mj = 1 / this.masses[j],
              im = mi + mj,
              correction = (r - d) / im;
            p[k] += nx * correction * mi;
            p[k + 1] += ny * correction * mi;
            p[k + 2] += nz * correction * mi;
            p[l] -= nx * correction * mj;
            p[l + 1] -= ny * correction * mj;
            p[l + 2] -= nz * correction * mj;
            const vx = v[k] - v[l],
              vy = v[k + 1] - v[l + 1],
              vz = v[k + 2] - v[l + 2],
              vn = vx * nx + vy * ny + vz * nz;
            if (vn >= 0) continue;
            const jn = (-(1 + this.restitution) * vn) / im;
            const wx = ri * w[k] + rj * w[l],
              wy = ri * w[k + 1] + rj * w[l + 1],
              wz = ri * w[k + 2] + rj * w[l + 2];
            const tx = vx - vn * nx - (wy * nz - wz * ny),
              ty = vy - vn * ny - (wz * nx - wx * nz),
              tz = vz - vn * nz - (wx * ny - wy * nx);
            const slip = Math.hypot(tx, ty, tz),
              jt =
                slip > 1e-12
                  ? Math.min(this.friction * jn, slip / (3.5 * im)) / slip
                  : 0;
            const jx = jn * nx - jt * tx,
              jy = jn * ny - jt * ty,
              jz = jn * nz - jt * tz;
            v[k] += jx * mi;
            v[k + 1] += jy * mi;
            v[k + 2] += jz * mi;
            v[l] -= jx * mj;
            v[l + 1] -= jy * mj;
            v[l + 2] -= jz * mj;
            const ax = ny * jz - nz * jy,
              ay = nz * jx - nx * jz,
              az = nx * jy - ny * jx;
            w[k] -= ((2.5 * mi) / ri) * ax;
            w[k + 1] -= ((2.5 * mi) / ri) * ay;
            w[k + 2] -= ((2.5 * mi) / ri) * az;
            w[l] -= ((2.5 * mj) / rj) * ax;
            w[l + 1] -= ((2.5 * mj) / rj) * ay;
            w[l + 2] -= ((2.5 * mj) / rj) * az;
          }
    }
  }
  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1)
      throw new RangeError("Time step must be between zero and one second.");
    this.accumulator += dt * this.speed;
    const steps = Math.floor((this.accumulator + 1e-12) / this.step),
      audio = new Float32Array(steps);
    this.accumulator -= steps * this.step;
    for (let s = 0; s < steps; s++) {
      if (this.auto && this.time >= this.nextAt) this.next();
      const phaseStep = 2 * Math.PI * this.frequency * this.step;
      this.modal.advance(this.drive * Math.sin(this.phase + phaseStep * 0.5));
      this.phase = (this.phase + phaseStep) % (2 * Math.PI);
      this.stepGrains(this.step);
      if (this.collisions && this.ticks % 2 === 0) this.collideGrains();
      let pickup = 0;
      for (let m = 0; m < COUNT; m++)
        pickup += this.pickup[m] * this.modal.v[m];
      audio[s] = pickup;
      this.ticks++;
      this.time = this.ticks * this.step;
    }
    this.audioSamples = audio;
    this.syncRenderState(steps * this.step);
    return audio;
  }
  syncRenderState(dt = 0) {
    for (let i = 0; i < this.grainCount; i++) {
      const k = i * 3;
      this.positions[k] = this.p[k] * WORLD_SCALE;
      this.positions[k + 1] = REST_HEIGHT + this.p[k + 1] * WORLD_SCALE;
      this.positions[k + 2] = this.p[k + 2] * WORLD_SCALE;
      if (dt === 0) continue;
      // Orientation only affects the faceted rendering; spherical inertia is isotropic.
      const o = i * 4,
        q = this.orientations,
        x = q[o],
        y = q[o + 1],
        z = q[o + 2],
        s = q[o + 3];
      const wx = this.spin[k] * dt * 0.5,
        wy = this.spin[k + 1] * dt * 0.5,
        wz = this.spin[k + 2] * dt * 0.5;
      const a = x + wx * s + wy * z - wz * y,
        b = y - wx * z + wy * s + wz * x,
        c = z + wx * y - wy * x + wz * s,
        d = s - wx * x - wy * y - wz * z;
      const inv = 1 / Math.hypot(a, b, c, d);
      q[o] = a * inv;
      q[o + 1] = b * inv;
      q[o + 2] = c * inv;
      q[o + 3] = d * inv;
    }
    this.updateHeight();
  }
  updateHeight() {
    const q = this.modal.q;
    for (let k = 0; k < GRID * GRID; k++) {
      let h = 0;
      for (let m = 0; m < COUNT; m++) h += this.fields[k * COUNT + m] * q[m];
      this.height[k] = REST_HEIGHT + h * WORLD_SCALE;
    }
  }
  sample(field, x, z) {
    const u = clamp((x / RADIUS + 1) * 0.5 * (GRID - 1), 0, GRID - 1.00001),
      v = clamp((z / RADIUS + 1) * 0.5 * (GRID - 1), 0, GRID - 1.00001);
    const i = Math.floor(u),
      j = Math.floor(v),
      a = u - i,
      b = v - j,
      k = j * GRID + i;
    return (
      (field[k] * (1 - a) + field[k + 1] * a) * (1 - b) +
      (field[k + GRID] * (1 - a) + field[k + GRID + 1] * a) * b
    );
  }
  reset() {
    this.time = this.ticks = this.accumulator = this.phase = 0;
    this.mode = 0;
    this.nextAt = 120;
    this.frequency = modeFrequency(0);
    this.modal.reset();
    this.scatter();
    this.audioSamples = new Float32Array(0);
  }
}
