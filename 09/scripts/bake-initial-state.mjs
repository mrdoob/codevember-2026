// Reproducible warm start: evolve the actual solver, never place grains on nodes.
import { writeFile } from "node:fs/promises";
import { MembraneSimulation } from "../simulation.js";
import { createFineSandSimulation } from "../physics/fine-sand.js";
import { createContactKernel, attachContactKernel } from "../physics/kernel.js";
import { encodeSnapshot } from "../physics/snapshot.js";
const coarse = process.argv.includes("--coarse"),
  seconds = coarse ? 120 : 46;
const sim = coarse ? new MembraneSimulation() : createFineSandSimulation();
attachContactKernel(sim, await createContactKernel());
sim.auto = false;
for (let i = 0; i < seconds; i++) {
  sim.advance(1);
  if ((i + 1) % 10 === 0 || i + 1 === seconds)
    console.log(`Settled ${i + 1} physical seconds`);
}
await writeFile(
  new URL(
    coarse
      ? "../physics/initial-state.bin"
      : "../physics/initial-state-fine.bin",
    import.meta.url,
  ),
  new Uint8Array(encodeSnapshot(sim)),
);
sim.dispose();
