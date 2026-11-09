// Run in the experiment's browser console (WebGPU device required):
// membrane.manual=true;
// await (await import('./tests/gpu-checks.js')).runGPUChecks(membrane.renderer)
import { MembraneSimulation, GRID } from "../simulation.js";
import { BASIS, basisShape } from "../modes.js";
import { attachGPUKernel } from "../physics/gpu-kernel.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const close = (actual, expected, tolerance, label) =>
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected} (±${tolerance})`,
  );
const energy = (s) => {
  let sum = s.modal.energy;
  for (let i = 0; i < s.grainCount; i++)
    for (let a = 0; a < 3; a++)
      sum +=
        0.5 * s.masses[i] * s.velocities[i * 3 + a] ** 2 +
        0.2 * s.masses[i] * s.radii[i] ** 2 * s.spin[i * 3 + a] ** 2;
  return sum;
};
export async function runGPUChecks(renderer, { only } = {}) {
  const results = [];
  async function check(name, options, setup, run) {
    if (only && !only.includes(name)) return;
    const s = new MembraneSimulation(options);
    s.auto = false;
    s.drive = 0;
    setup(s);
    await attachGPUKernel(s, renderer);
    try {
      const evidence = await run(s);
      results.push({ name, pass: true, ...evidence });
    } finally {
      await s.gpu.idle();
      s.dispose();
    }
  }
  await check(
    "quadrant compression preserves the full modal basis",
    { grainCount: 1 },
    () => {},
    async (s) => {
      let maximum = 0;
      for (let z = 0; z < GRID; z++)
        for (let x = 0; x < GRID; x++)
          for (let m = 0; m < BASIS.length; m++) {
            const mode = BASIS[m],
              flippedX = x < 72 && (mode.m + Number(mode.sine)) % 2 !== 0,
              flippedZ = z < 72 && mode.sine;
            const actual =
              s.fields[
                ((Math.abs(z - 72) + 72) * GRID + Math.abs(x - 72) + 72) *
                  BASIS.length +
                  m
              ] * (flippedX !== flippedZ ? -1 : 1);
            maximum = Math.max(
              maximum,
              Math.abs(actual - s.fields[(z * GRID + x) * BASIS.length + m]),
            );
          }
      assert(maximum < 1e-6, "basis reflection error");
      return { maximumError: maximum };
    },
  );
  await check(
    "GPU field reconstruction matches the full modal sum",
    { grainCount: 1, gravity: 0 },
    (s) => {
      s.p.set([0, 0.1, 0]);
      for (let m = 0; m < BASIS.length; m++) {
        s.modal.q[m] = Math.sin(m * 0.618) * 0.00003;
        s.modal.v[m] = Math.cos(m * 0.71) * 0.02;
      }
    },
    async (s) => {
      await s.gpu.readback();
      let maximum = 0;
      for (let k = 0; k < GRID * GRID; k++) {
        let h = 0;
        for (let m = 0; m < BASIS.length; m++)
          h += s.fields[k * BASIS.length + m] * s.modal.q[m];
        maximum = Math.max(maximum, Math.abs(s.height[k] - (0.21 + 20 * h)));
      }
      assert(
        maximum < 1e-6,
        "mirrored surface field differs from the reference",
      );
      return { maximumSceneHeightError: maximum };
    },
  );
  await check(
    "2x playback retains the fixed step and supports a full-second advance",
    { grainCount: 1, gravity: 0 },
    (s) => {
      s.speed = 2;
      s.p.set([0, 0.1, 0]);
      s.velocities.set([0.001, 0, 0]);
    },
    async (s) => {
      s.advance(1);
      await s.gpu.readback();
      close(s.time, 2, 1e-12, "physical time");
      assert(s.ticks === 9600, "physics step changed");
      close(s.p[0], 0.002, 2e-6, "double-speed ballistic motion");
      return { physicalSeconds: s.time, steps: s.ticks };
    },
  );
  await check(
    "ballistic flight has no lateral force",
    { grainCount: 1 },
    (s) => {
      s.p.set([0.02, 0.05, 0.01]);
      s.velocities.set([0.01, 0.03, -0.02]);
    },
    async (s) => {
      s.advance(0.02);
      await s.gpu.readback();
      close(s.p[0], 0.0202, 2e-7, "x");
      close(s.p[2], 0.0096, 2e-7, "z");
      close(
        s.p[1],
        0.05 + 0.03 * 0.02 - 0.5 * 9.81 * 0.02 ** 2,
        2e-7,
        "height",
      );
      close(s.velocities[1], 0.03 - 9.81 * 0.02, 2e-6, "vertical velocity");
    },
  );
  await check(
    "membrane impact returns its generalized reaction impulse",
    { grainCount: 1, gravity: 0 },
    (s) => {
      s.friction = s.rollingFriction = 0;
      s.p.set([0.03, s.radii[0] - 0.000001, 0.02]);
      s.velocities.set([0, -0.2, 0]);
      s.cacheGrain(0);
    },
    async (s) => {
      s.advance(s.step);
      await s.gpu.readback();
      const impulse = (s.velocities[1] + 0.2) * s.masses[0];
      let surfaceVelocity = 0;
      for (let m = 0; m < BASIS.length; m++) {
        close(
          s.modal.v[m],
          (-impulse * s.phi[m]) / BASIS[m].mass,
          2e-10,
          "reaction",
        );
        surfaceVelocity += s.phi[m] * s.modal.v[m];
      }
      close(
        s.velocities[1] - surfaceVelocity,
        0.2 * s.restitution,
        2e-7,
        "relative restitution",
      );
    },
  );
  await check(
    "isolated pair conserves momentum and satisfies restitution",
    { grainCount: 2, gravity: 0 },
    (s) => {
      s.friction = 0;
      s.restitution = 0.4;
      const r = 0.0004,
        m = (4 / 3) * Math.PI * r ** 3 * 2650;
      s.radii.fill(r);
      s.masses.fill(m);
      s.p.set([0, 0.01, 0, r * 1.99, 0.01, 0]);
      s.velocities.set([0.1, 0, 0, -0.1, 0, 0]);
    },
    async (s) => {
      s.advance(s.step);
      await s.gpu.readback();
      close(s.velocities[0] + s.velocities[3], 0, 1e-7, "momentum");
      close(s.velocities[3] - s.velocities[0], 0.08, 1e-7, "relative velocity");
      close(
        (s.velocities[0] ** 2 + s.velocities[3] ** 2) / 0.02,
        0.16,
        1e-6,
        "energy ratio",
      );
    },
  );
  let initialEnergy;
  await check(
    "sliding contact creates spin and dissipates energy",
    { grainCount: 1, gravity: 0 },
    (s) => {
      s.p.set([0, s.radii[0] - 0.000001, 0]);
      s.velocities.set([0.1, -0.2, 0]);
      initialEnergy = energy(s);
    },
    async (s) => {
      s.advance(s.step);
      await s.gpu.readback();
      assert(s.velocities[0] < 0.1, "friction did not reduce speed");
      assert(Math.abs(s.spin[2]) > 0, "no angular impulse");
      assert(energy(s) < initialEnergy, "friction added energy");
    },
  );
  await check(
    "overfull contact lists use every pair and remain dissipative",
    { grainCount: 80, gravity: 0 },
    (s) => {
      s.friction = 0;
      s.restitution = 0.4;
      s.radii.fill(0.0004);
      s.masses.fill((4 / 3) * Math.PI * 0.0004 ** 3 * 2650);
      for (let i = 0; i < s.grainCount; i++) {
        const angle = (2 * Math.PI * i) / s.grainCount;
        s.p.set(
          [0.0001 * Math.cos(angle), 0.02, 0.0001 * Math.sin(angle)],
          i * 3,
        );
        s.velocities.set(
          [-0.1 * Math.cos(angle), 0, -0.1 * Math.sin(angle)],
          i * 3,
        );
      }
      initialEnergy = energy(s);
    },
    async (s) => {
      s.advance(s.step);
      await s.gpu.readback();
      assert(
        s.gpu.stats.maxContacts === 79,
        "overflow neighborhood lost a pair",
      );
      let px = 0,
        pz = 0;
      for (let i = 0; i < s.grainCount; i++) {
        px += s.velocities[i * 3];
        pz += s.velocities[i * 3 + 2];
      }
      close(px, 0, 1e-5, "x momentum");
      close(pz, 0, 1e-5, "z momentum");
      assert(energy(s) < initialEnergy, "simultaneous contacts added energy");
      return {
        maxContacts: s.gpu.stats.maxContacts,
        energyRatio: energy(s) / initialEnergy,
      };
    },
  );
  await check(
    "GPU forced modes and PCM agree with the double precision reference",
    { grainCount: 1, gravity: 0 },
    (s) => {
      s.p.set([0, 0.1, 0]);
      s.drive = 0.12;
    },
    async (s) => {
      const reference = new MembraneSimulation({ grainCount: 1, gravity: 0 });
      reference.auto = false;
      reference.p.set([0, 0.1, 0]);
      const samples = [];
      s.gpu.onAudio = (pcm) => samples.push(...pcm);
      for (let i = 0; i < 4; i++) {
        s.advance(0.125);
        reference.advance(0.125);
        await s.gpu.idle();
        await new Promise((r) => setTimeout(r, 0));
      }
      await s.gpu.readback();
      let maxQ = 0,
        maxV = 0;
      for (let m = 0; m < BASIS.length; m++) {
        maxQ = Math.max(maxQ, Math.abs(s.modal.q[m] - reference.modal.q[m]));
        maxV = Math.max(maxV, Math.abs(s.modal.v[m] - reference.modal.v[m]));
      }
      assert(maxQ < 2e-8 && maxV < 2e-5, "modal integration drift");
      assert(samples.length === 2400, "PCM was dropped");
      assert(
        samples.every(Number.isFinite) &&
          samples.some((x) => Math.abs(x) > 1e-3),
        "invalid pickup signal",
      );
      // Contact-free PCM must be exactly the same modal velocity pickup, up to f32.
      close(samples.at(-1), reference.audioSamples.at(-1), 2e-5, "pickup");
      return {
        maxDisplacementError: maxQ,
        maxVelocityError: maxV,
        pcmSamples: samples.length,
      };
    },
  );
  await check(
    "scatter, taps, reset, and batch boundaries preserve state",
    { grainCount: 40 },
    () => {},
    async (s) => {
      s.drive = 0.12;
      s.advance(0.02);
      await s.gpu.readback();
      const beforeQ = s.modal.q.slice();
      s.scatter();
      await s.gpu.readback();
      for (let m = 0; m < BASIS.length; m++)
        close(s.modal.q[m], beforeQ[m], 1e-12, "scatter changed displacement");
      assert(
        s.velocities.every((x) => x === 0),
        "scatter velocities",
      );
      const original = s.p.slice();
      s.pluck(0.3, 0.4);
      await s.gpu.readback();
      assert(
        s.p.every((x, i) => x === original[i]),
        "tap moved grains immediately",
      );
      s.advance(s.step);
      await s.gpu.readback();
      assert(
        s.modal.v.some((x) => Math.abs(x) > 0.001),
        "tap had no response",
      );
      s.reset();
      await s.gpu.readback();
      const reset = s.p.slice();
      s.advance(0.01);
      s.reset();
      await s.gpu.readback();
      assert(
        s.p.every((x, i) => x === reset[i]),
        "reset not reproducible",
      );
      const state = s.modal.q.slice();
      s.advance(0);
      await s.gpu.readback();
      assert(
        s.modal.q.every((x, i) => x === state[i]),
        "zero step mutated state",
      );
      for (const dt of [-1, NaN, Infinity, 1.1]) {
        let threw = false;
        try {
          s.advance(dt);
        } catch {
          threw = true;
        }
        assert(threw, "invalid time accepted");
      }
    },
  );
  await check(
    "nodal migration emerges from GPU contacts",
    { grainCount: 200 },
    (s) => {
      s.drive = 0.12;
    },
    async (s) => {
      const selected = BASIS.map((mode, i) => ({ mode, i }))
        .filter(({ mode }) => mode.m === 2 && mode.n === 2)
        .map(({ i }) => i);
      const score = () => {
        let sum = 0;
        for (let j = 0; j < s.grainCount; j++) {
          let value = 0;
          for (const m of selected)
            value +=
              s.modal.coupling[m] * basisShape(m, s.p[j * 3], s.p[j * 3 + 2]);
          sum += value * value;
        }
        return sum / s.grainCount;
      };
      const before = score(),
        settled = [];
      // Grain impacts and parallel impulse accumulation make one instant a
      // noisy measure of migration. Require sustained accumulation instead:
      // sample the last 20 seconds of a 60-second run, once per second.
      for (let i = 0; i < 240; i++) {
        s.advance(0.25);
        await s.gpu.idle();
        if (i >= 160 && (i + 1) % 4 === 0) {
          await s.gpu.readback();
          settled.push(score() / before);
        }
      }
      const ratio =
        settled.reduce((sum, value) => sum + value, 0) / settled.length;
      assert(ratio < 0.75, `sustained migration failed: ${ratio}`);
      assert(
        s.p.every(Number.isFinite) && s.velocities.every(Number.isFinite),
        "nonfinite particles",
      );
      return {
        physicalSeconds: s.time,
        meanNodalEnergyRatio: ratio,
        samples: settled.length,
      };
    },
  );
  return results;
}
