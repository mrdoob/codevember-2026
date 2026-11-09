import test from "node:test";
import assert from "node:assert/strict";
import {
  besselJ,
  BASIS,
  MODES,
  PHYSICAL_RADIUS,
  SURFACE_DENSITY,
  TENSION,
  basisShape,
  modeFrequency,
} from "../modes.js";
import { ModalSystem } from "../modal-system.js";
import { MembraneSimulation, PHYSICS_STEP } from "../simulation.js";
import { createContactKernel, attachContactKernel } from "../physics/kernel.js";
const kernel = await createContactKernel();
const create = (options) => {
  const s = new MembraneSimulation(options);
  attachContactKernel(s, kernel);
  return s;
};
const close = (a, b, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(a - b) <= tolerance,
    `${a} ≠ ${b} (tolerance ${tolerance})`,
  );

// These checks have independent analytical targets; visual similarity alone is
// not evidence for correct mechanics.
test("all retained modes satisfy the fixed rim and dimensional dispersion relation", () => {
  for (let i = 0; i < BASIS.length; i++) {
    const m = BASIS[i];
    assert.ok(Math.abs(besselJ(m.m, m.root)) < 1e-9);
    close(
      m.omega,
      (m.root / PHYSICAL_RADIUS) * Math.sqrt(TENSION / SURFACE_DENSITY),
    );
    for (let a = 0; a < 24; a++)
      close(basisShape(i, 0.15 * Math.cos(a), 0.15 * Math.sin(a)), 0, 1e-12);
    if (m.m > 0)
      assert.ok(
        BASIS.some(
          (other) =>
            other.m === m.m && other.n === m.n && other.sine !== m.sine,
        ),
      );
  }
});

test("free undamped modal motion conserves energy and has the analytical period", () => {
  const s = new ModalSystem({ step: PHYSICS_STEP, gravity: 0, damping: 0 }),
    index = 12,
    mode = BASIS[index];
  s.q[index] = 0.0002;
  const initial = s.energy;
  for (let i = 0; i < 4800; i++) s.advance(0);
  close(s.energy / initial, 1, 1e-10);
  close(s.q[index], 0.0002 * Math.cos(mode.omega), 1e-14);
});

test("viscous modal damping matches the analytical decay", () => {
  const s = new ModalSystem({ step: PHYSICS_STEP, gravity: 0, damping: 0.008 });
  s.q[0] = 0.0002;
  const w = BASIS[0].omega,
    d = s.damping * w,
    wd = Math.sqrt(w * w - d * d),
    t = 0.25;
  for (let i = 0; i < 1200; i++) s.advance(0);
  close(
    s.q[0],
    0.0002 *
      Math.exp(-d * t) *
      (Math.cos(wd * t) + (d / wd) * Math.sin(wd * t)),
    1e-14,
  );
});

function forcedResponse(frequency, step = PHYSICS_STEP) {
  const s = new ModalSystem({ step, gravity: 0 }),
    index = BASIS.findIndex((m) => m.m === 2 && m.n === 2 && !m.sine);
  const w = 2 * Math.PI * frequency,
    force = 0.075,
    steps = Math.round(2 / step);
  for (let i = 0; i < steps; i++)
    s.advance(force * Math.sin(w * (i + 0.5) * step));
  const mode = BASIS[index],
    den =
      (mode.omega ** 2 - w * w) ** 2 + (2 * s.damping * mode.omega * w) ** 2;
  const a =
    (((force * s.coupling[index]) / mode.mass) * (mode.omega ** 2 - w * w)) /
    den;
  const b =
    (((-force * s.coupling[index]) / mode.mass) *
      (2 * s.damping * mode.omega * w)) /
    den;
  return {
    actual: s.q[index],
    expected: a * Math.sin(w * 2) + b * Math.cos(w * 2),
    amplitude: Math.hypot(a, b),
  };
}
test("forced resonance and detuned response agree with the oscillator transfer function", () => {
  for (const f of [modeFrequency(0), modeFrequency(0) * 1.06]) {
    const result = forcedResponse(f);
    close(result.actual, result.expected, result.amplitude * 0.003);
  }
  assert.ok(
    forcedResponse(modeFrequency(0)).amplitude >
      forcedResponse(modeFrequency(0) * 1.06).amplitude * 5,
  );
});
test("halving the physics step reduces forced-response integration error", () => {
  const coarse = forcedResponse(modeFrequency(0), 1 / 2400),
    fine = forcedResponse(modeFrequency(0), 1 / 4800);
  assert.ok(
    Math.abs(fine.actual - fine.expected) <
      Math.abs(coarse.actual - coarse.expected) * 0.3,
  );
});

test("airborne grains follow the ballistic trajectory with no lateral attraction", () => {
  const s = create({ grainCount: 1 });
  s.auto = false;
  s.drive = 0;
  s.p.set([0.02, 0.05, 0.01]);
  s.velocities.set([0.01, 0.03, -0.02]);
  s.advance(0.02);
  close(s.p[0], 0.0202, 1e-12);
  close(s.p[2], 0.0096, 1e-12);
  close(s.p[1], 0.05 + 0.03 * 0.02 - 0.5 * 9.81 * 0.02 ** 2, 1e-12);
  close(s.velocities[1], 0.03 - 9.81 * 0.02, 1e-12);
  s.dispose();
});

test("a membrane impact obeys restitution and returns equal/opposite generalized impulse", () => {
  const s = create({ grainCount: 1, gravity: 0 });
  s.friction = 0;
  s.rollingFriction = 0;
  s.p.set([0.03, s.radii[0] - 0.000001, 0.02]);
  s.velocities.set([0, -0.2, 0]);
  s.cacheGrain(0);
  const before = s.velocities[1],
    mass = s.masses[0];
  s.stepGrains(s.step);
  const impulse = (s.velocities[1] - before) * mass;
  let surfaceVelocity = 0;
  for (let m = 0; m < BASIS.length; m++) {
    close(s.modal.v[m], (-impulse * s.phi[m]) / BASIS[m].mass, 1e-12);
    surfaceVelocity += s.phi[m] * s.modal.v[m];
  }
  close(s.velocities[1] - surfaceVelocity, -before * s.restitution, 1e-11);
  s.dispose();
});

test("sphere collision conserves momentum and loses the restitution-predicted energy", () => {
  const s = create({ grainCount: 2, gravity: 0 });
  s.friction = 0;
  s.restitution = 0.4;
  const r = 0.0004,
    m = (4 / 3) * Math.PI * r ** 3 * 2650;
  s.radii.fill(r);
  s.masses.fill(m);
  s.p.set([0, 0.01, 0, r * 1.99, 0.01, 0]);
  s.velocities.set([0.1, 0, 0, -0.1, 0, 0]);
  s.collideGrains();
  close(s.velocities[0] + s.velocities[3], 0, 1e-12);
  close(s.velocities[3] - s.velocities[0], 0.2 * 0.4, 1e-12);
  close((s.velocities[0] ** 2 + s.velocities[3] ** 2) / 0.02, 0.4 ** 2, 1e-12);
  s.dispose();
});

test("Coulomb contact reduces slip, creates spin, and dissipates total kinetic energy", () => {
  const s = create({ grainCount: 1, gravity: 0 });
  s.p.set([0, s.radii[0] - 0.000001, 0]);
  s.velocities.set([0.1, -0.2, 0]);
  s.cacheGrain(0);
  const m = s.masses[0],
    r = s.radii[0],
    before = 0.5 * m * (0.1 ** 2 + 0.2 ** 2);
  s.stepGrains(s.step);
  const after =
    0.5 * m * s.velocities.reduce((a, x) => a + x * x, 0) +
    0.2 * m * r * r * s.spin.reduce((a, x) => a + x * x, 0) +
    s.modal.energy;
  assert.ok(s.velocities[0] < 0.1);
  assert.ok(Math.abs(s.spin[2]) > 0);
  assert.ok(after < before);
  s.dispose();
});

test("fixed stepping gives identical physical trajectories at 30 and 120 fps", () => {
  const a = create({ grainCount: 40 }),
    b = create({ grainCount: 40 });
  a.auto = b.auto = false;
  a.pluck(0.4, 0.8);
  b.pluck(0.4, 0.8);
  for (let i = 0; i < 30; i++) a.advance(1 / 30);
  for (let i = 0; i < 120; i++) b.advance(1 / 120);
  assert.deepEqual(a.p, b.p);
  assert.deepEqual(a.velocities, b.velocities);
  assert.deepEqual(a.modal.q, b.modal.q);
  a.dispose();
  b.dispose();
});

test("the WebAssembly kernel agrees with the JavaScript reference equations", () => {
  const a = create({ grainCount: 20 }),
    b = new MembraneSimulation({ grainCount: 20 });
  a.auto = b.auto = false;
  a.advance(0.015);
  b.advance(0.015);
  for (let i = 0; i < a.p.length; i++) close(a.p[i], b.p[i], 1e-10);
  for (let i = 0; i < a.velocities.length; i++)
    close(a.velocities[i], b.velocities[i], 1e-8);
  a.dispose();
});

test("taps add membrane momentum without directly scattering grains; drive-off rings down", () => {
  const s = create({ grainCount: 30 });
  s.auto = false;
  s.advance(0.5);
  const velocities = s.velocities.slice();
  s.pluck(0.5, 0.6);
  assert.deepEqual(s.velocities, velocities);
  s.drive = 0;
  const before = s.modal.energy;
  for (let i = 0; i < 3; i++) s.advance(1);
  assert.ok(s.modal.energy < before * 0.01);
  s.dispose();
});

test("reset is deterministic and invalid inputs are rejected", () => {
  const s = create({ grainCount: 20 }),
    initial = s.p.slice(),
    q = s.modal.q.slice();
  s.advance(0.1);
  s.next();
  s.pluck(1, 0);
  s.reset();
  assert.deepEqual(s.p, initial);
  assert.deepEqual(s.modal.q, q);
  assert.equal(s.time, 0);
  assert.equal(s.pluck(NaN, 0), false);
  assert.equal(s.pluck(4, 0), false);
  for (const dt of [-1, Infinity, NaN, 1.1])
    assert.throws(() => s.advance(dt), RangeError);
  for (const mode of [-1, MODES.length, NaN, 0.5])
    assert.throws(() => s.selectMode(mode), RangeError);
  for (const f of [NaN, 0, 301])
    assert.throws(() => (s.frequency = f), RangeError);
  s.dispose();
});

test("a settled checkpoint round-trips the complete dynamical state", async () => {
  const { encodeSnapshot, restoreSnapshot } = await import(
    "../physics/snapshot.js"
  );
  const a = create({ grainCount: 30 }),
    b = create({ grainCount: 30 });
  a.auto = b.auto = false;
  a.advance(0.25);
  a.pluck(0.3, 0.4);
  a.advance(0.1);
  restoreSnapshot(b, encodeSnapshot(a));
  for (const name of ["p", "velocities", "spin", "orientations"])
    assert.deepEqual(a[name], b[name]);
  assert.deepEqual(a.modal.q, b.modal.q);
  assert.deepEqual(a.modal.v, b.modal.v);
  close(a.phase, b.phase);
  assert.throws(() => restoreSnapshot(b, new ArrayBuffer(8)), /Incompatible/);
  a.dispose();
  b.dispose();
});

test("nodal migration emerges from contacts over a sustained drive", () => {
  const s = create({ grainCount: 200 });
  s.auto = false;
  const modes = BASIS.map((m, i) => ({ m, i }))
    .filter(({ m }) => m.m === 2 && m.n === 2)
    .map(({ i }) => i);
  const energy = () => {
    let sum = 0;
    for (let j = 0; j < s.grainCount; j++) {
      let value = 0;
      for (const i of modes)
        value +=
          s.modal.coupling[i] * basisShape(i, s.p[j * 3], s.p[j * 3 + 2]);
      sum += value * value;
    }
    return sum / s.grainCount;
  };
  const before = energy();
  for (let i = 0; i < 40; i++) s.advance(1);
  assert.ok(energy() < before * 0.65, `initial ${before}, final ${energy()}`);
  assert.ok(s.p.every(Number.isFinite));
  assert.ok(s.velocities.every(Number.isFinite));
  s.dispose();
});

test("a full automatic frequency cycle with repeated impulses remains finite", () => {
  const s = create({ grainCount: 24 });
  for (let i = 0; i < MODES.length * 120 + 5; i++) {
    if (i % 40 === 0) s.pluck(0.5, 0.6);
    s.advance(1);
  }
  assert.equal(s.mode, 0);
  assert.ok(s.p.every(Number.isFinite));
  assert.ok(s.modal.q.every(Number.isFinite));
  assert.ok(Math.max(...s.height) < 0.3);
  assert.ok(Math.min(...s.height) > 0.1);
  s.dispose();
});
