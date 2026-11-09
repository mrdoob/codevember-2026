import createModule from "./contacts.js";
import { BASIS } from "../modes.js";

export async function createContactKernel() {
  return createModule();
}
export function attachContactKernel(sim, module) {
  const allocations = [];
  const bind = (object, key) => {
    const old = object[key],
      ptr = module._malloc(Math.max(8, old.byteLength));
    const view = new old.constructor(module.HEAPU8.buffer, ptr, old.length);
    view.set(old);
    object[key] = view;
    allocations.push(ptr);
    return ptr;
  };
  const modeMass = { value: Float64Array.from(BASIS, (m) => m.mass) };
  sim.heads = new Int32Array(1024 * 1024);
  const pointers = [
    bind(sim, "p"),
    bind(sim, "velocities"),
    bind(sim, "spin"),
    bind(sim, "radii"),
    bind(sim, "masses"),
    bind(sim.modal, "q"),
    bind(sim.modal, "v"),
    bind(modeMass, "value"),
    bind(sim, "reaction"),
    bind(sim, "fields"),
    bind(sim, "phi"),
    bind(sim, "dx"),
    bind(sim, "dz"),
    bind(sim, "cacheX"),
    bind(sim, "cacheZ"),
    bind(sim, "inverseSurfaceMass"),
    bind(sim, "heads"),
    bind(sim, "links"),
    bind(sim, "cellX"),
    bind(sim, "cellZ"),
  ];
  const workspace = {
    occupiedCells: new Int32Array(sim.grainCount),
    stamp: new Uint32Array(145 * 145),
    values: new Float32Array(145 * 145 * 2),
    impulses: new Float64Array(145 * 145),
    active: new Int32Array(145 * 145),
    gram: new Float64Array(145 * 145 * 10),
    control: new Uint32Array(2),
    inverseMass: new Float64Array(sim.grainCount),
    angularMass: new Float64Array(sim.grainCount),
    headStamp: new Uint32Array(1024 * 1024),
    buildY: new Float64Array(sim.grainCount),
  };
  for (const key of Object.keys(workspace)) pointers.push(bind(workspace, key));
  const table = module._malloc(pointers.length * 4);
  module.HEAPU32.set(pointers, table / 4);
  allocations.push(table);
  module._prepare_surface(table, 145, BASIS.length);
  sim.stepGrains = (dt) =>
    module._step_grains(
      table,
      sim.grainCount,
      BASIS.length,
      145,
      dt,
      sim.gravity,
      sim.friction,
      sim.restitution,
      sim.rollingFriction,
    );
  sim.collideGrains = () =>
    module._collide_grains(
      table,
      sim.grainCount,
      sim.friction,
      sim.restitution,
    );
  const height = bind(sim, "height");
  sim.updateHeight = () =>
    module._update_height(table, height, 145 * 145, BASIS.length);
  sim.dispose = () => allocations.forEach((p) => module._free(p));
}
