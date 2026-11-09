// Compare physical migration from identical scattered grains at each frequency.
import { MembraneSimulation } from "../simulation.js";
import { BASIS, basisShape } from "../modes.js";
import { createContactKernel, attachContactKernel } from "../physics/kernel.js";
const kernel = await createContactKernel();
const candidates = [
  [2, 2],
  [0, 3],
  [3, 2],
  [1, 2],
  [4, 2],
  [0, 2],
  [5, 1],
  [2, 3],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 2],
];
const seconds = Number(process.argv[2] || 60),
  count = Number(process.argv[3] || 600);
for (const [m, n] of candidates) {
  const s = new MembraneSimulation({ grainCount: count });
  s.auto = false;
  // Match the live sand's radius distribution, with a smaller test population.
  for (let i = 0; i < count; i++) {
    const r = s.radii[i];
    s.radii[i] *= 0.46316196503735396;
    s.masses[i] *= 0.46316196503735396 ** 3;
    s.p[i * 3 + 1] += s.radii[i] - r;
  }
  attachContactKernel(s, kernel);
  const indices = BASIS.map((mode, i) =>
    mode.m === m && mode.n === n ? i : -1,
  ).filter((i) => i >= 0);
  s.frequency = BASIS[indices[0]].omega / (2 * Math.PI);
  const score = () => {
    let sum = 0,
      near = 0;
    const coupling = Math.hypot(...indices.map((i) => s.modal.coupling[i]));
    for (let j = 0; j < count; j++) {
      let value = 0;
      for (const i of indices)
        value +=
          (s.modal.coupling[i] * basisShape(i, s.p[j * 3], s.p[j * 3 + 2])) /
          coupling;
      sum += value * value;
      if (Math.abs(value) < 0.1) near++;
    }
    return { mean: sum / count, near: near / count };
  };
  const initial = score();
  const start = performance.now();
  for (let i = 0; i < seconds; i++) s.advance(1);
  const final = score();
  console.log(
    JSON.stringify({
      mode: `${m},${n}`,
      frequency: s.frequency,
      seconds,
      ratio: final.mean / initial.mean,
      nearNodes: final.near,
      initialNearNodes: initial.near,
      wall: (performance.now() - start) / 1000,
    }),
  );
  s.dispose();
}
