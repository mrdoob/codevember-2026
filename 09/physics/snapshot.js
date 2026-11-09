import { BASIS } from "../modes.js";
const VERSION = 1,
  HEADER = 16;
const arrays = (sim) => [
  sim.p,
  sim.velocities,
  sim.spin,
  sim.modal.q,
  sim.modal.v,
  sim.orientations,
];

export function encodeSnapshot(sim) {
  const values = new Float64Array(
    HEADER + arrays(sim).reduce((n, a) => n + a.length, 0),
  );
  values.set([
    202609,
    VERSION,
    sim.grainCount,
    BASIS.length,
    sim.step,
    sim.seed,
    sim.ticks,
    sim.phase,
    sim.drive,
    sim.friction,
    sim.restitution,
    sim.rollingFriction,
    sim.frequency,
    sim.mode,
    sim.accumulator,
    sim.gravity,
  ]);
  let offset = HEADER;
  for (const a of arrays(sim)) {
    values.set(a, offset);
    offset += a.length;
  }
  return values.buffer;
}
export function restoreSnapshot(sim, buffer) {
  const values = new Float64Array(buffer),
    expected = HEADER + arrays(sim).reduce((n, a) => n + a.length, 0);
  if (
    values.length !== expected ||
    values[0] !== 202609 ||
    values[1] !== VERSION ||
    values[2] !== sim.grainCount ||
    values[3] !== BASIS.length ||
    values[4] !== sim.step ||
    values[5] !== sim.seed ||
    values[15] !== sim.gravity ||
    !values.every(Number.isFinite)
  )
    throw new Error("Incompatible membrane initial state.");
  let offset = HEADER;
  for (const a of arrays(sim)) {
    a.set(values.subarray(offset, offset + a.length));
    offset += a.length;
  }
  sim.ticks = values[6];
  sim.time = sim.ticks * sim.step;
  sim.phase = values[7];
  sim.drive = values[8];
  sim.friction = values[9];
  sim.restitution = values[10];
  sim.rollingFriction = values[11];
  sim.frequency = values[12];
  sim.mode = values[13];
  sim.accumulator = values[14];
  sim.cacheX.fill(Infinity);
  sim.nextAt = sim.time + 120;
  sim.syncRenderState();
}
