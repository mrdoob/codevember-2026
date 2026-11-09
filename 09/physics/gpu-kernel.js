import { StorageBufferAttribute } from "three/webgpu";
import { BASIS, WORLD_SCALE, basisShape } from "../modes.js";
import { GRID } from "../simulation.js";

const MODE_COUNT = BASIS.length,
  NODE_COUNT = GRID * GRID,
  MAX_STEPS = 9600,
  STRIDE = 256;
const empty = new Float32Array(0);

// GPU state is authoritative. readback() explicitly refreshes the CPU inspection
// arrays; rendering reads the same device buffers without a per-frame transfer.
export async function attachGPUKernel(sim, renderer) {
  if (GRID !== 145 || MODE_COUNT !== 34)
    throw new Error(
      "Update the GPU basis layout for this membrane discretization.",
    );
  const device = renderer.backend.device,
    queue = device.queue,
    owned = [];
  const buffer = (label, size, usage, data) => {
    const b = device.createBuffer({ label, size: Math.max(4, size), usage });
    owned.push(b);
    if (data) queue.writeBuffer(b, 0, data);
    return b;
  };
  const storage = (label, size, data) =>
    buffer(
      label,
      size,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
      data,
    );
  const drawAttribute = new StorageBufferAttribute(sim.grainCount, 4);
  const surfaceAttribute = new StorageBufferAttribute(NODE_COUNT, 4);
  renderer.backend.createStorageAttribute(drawAttribute);
  renderer.backend.createStorageAttribute(surfaceAttribute);
  const gram = new Float32Array(NODE_COUNT * 10);
  for (let z = 0; z < GRID - 1; z++)
    for (let x = 0; x < GRID - 1; x++) {
      const k = z * GRID + x,
        corners = [k, k + 1, k + GRID, k + GRID + 1];
      let index = 0;
      for (let i = 0; i < 4; i++)
        for (let j = i; j < 4; j++) {
          let value = 0;
          for (let m = 0; m < MODE_COUNT; m++)
            value +=
              (sim.fields[corners[i] * MODE_COUNT + m] *
                sim.fields[corners[j] * MODE_COUNT + m]) /
              BASIS[m].mass;
          gram[k * 10 + index++] = value;
        }
    }
  const basis = new Float32Array(73 * 73 * MODE_COUNT);
  for (let z = 0; z < 73; z++)
    for (let x = 0; x < 73; x++)
      for (let m = 0; m < MODE_COUNT; m++)
        basis[m * 73 * 73 + z * 73 + x] =
          sim.fields[((z + 72) * GRID + x + 72) * MODE_COUNT + m];
  const uniform = buffer(
    "physics parameters",
    MAX_STEPS * STRIDE,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const states = [
    storage("grains A", sim.grainCount * 48),
    storage("grains B", sim.grainCount * 48),
  ];
  const resources = {
    0: uniform,
    3: storage("membrane modes", (MODE_COUNT + 1) * 48),
    4: storage("modal basis", basis.byteLength, basis),
    5: storage("membrane samples", NODE_COUNT * 16),
    6: storage("surface effective mass", gram.byteLength, gram),
    7: storage("spatial hash", 65537 * 4),
    8: storage("cell links", sim.grainCount * 16),
    9: storage("contact lists", sim.grainCount * 260),
    10: renderer.backend.get(drawAttribute).buffer,
    11: renderer.backend.get(surfaceAttribute).buffer,
    14: storage("active contact samples", (NODE_COUNT + 1) * 4),
    12: storage("contact pickup", MAX_STEPS * 4),
    13: storage("tap impulse", MODE_COUNT * 4),
  };
  const response = await fetch(new URL("./solver.wgsl", import.meta.url));
  if (!response.ok) throw new Error("GPU solver source could not be loaded.");
  const source = await response.text();
  const shader = device.createShaderModule({
    label: "membrane physics",
    code: source,
  });
  const info = await shader.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length)
    throw new Error(
      errors.map((m) => `solver.wgsl:${m.lineNum}: ${m.message}`).join("\n"),
    );
  const bindings = {
    modal: [0, 3, 4, 5, 13, 14],
    field: [0, 3, 4, 5, 14],
    compact: [0, 5, 14],
    contact: [0, 1, 3, 5, 6, 12],
    clearHeads: [7],
    buildHeads: [0, 1, 7, 8],
    findNeighbors: [0, 1, 7, 8, 9],
    collide: [0, 1, 2, 7, 8, 9],
    draw: [0, 1, 5, 10, 11],
    place: [0, 1, 5, 6],
  };
  const stages = {};
  for (const [name, list] of Object.entries(bindings)) {
    const layout = device.createBindGroupLayout({
      entries: list.map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer:
          binding === 0
            ? { type: "uniform", hasDynamicOffset: true, minBindingSize: 48 }
            : {
                type: [4, 6, 13].includes(binding)
                  ? "read-only-storage"
                  : "storage",
              },
      })),
    });
    const pipeline = await device.createComputePipelineAsync({
      label: name,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: shader, entryPoint: name },
    });
    const groups = states.map((_, parity) =>
      device.createBindGroup({
        layout,
        entries: list.map((binding) => ({
          binding,
          resource: {
            buffer:
              binding === 1
                ? states[parity]
                : binding === 2
                  ? states[1 - parity]
                  : resources[binding],
            ...(binding === 0 ? { size: 48 } : {}),
          },
        })),
      }),
    );
    stages[name] = { pipeline, groups, dynamic: list.includes(0) };
  }
  let parity = 0,
    disposed = false,
    kickPending = false,
    inFlight = 0;
  const kicks = new Float32Array(MODE_COUNT),
    params = new ArrayBuffer(MAX_STEPS * STRIDE),
    words = new Uint32Array(params),
    floats = new Float32Array(params);
  let hashCell = 2 * Math.max(...sim.radii);
  const stats = {
    submittedSteps: 0,
    lastBatchMs: 0,
    lastBatchSteps: 0,
    maxContacts: 0,
  };
  const audioSlots = Array.from({ length: 3 }, () => ({
    busy: false,
    buffer: buffer(
      "audio readback",
      MAX_STEPS * 4,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    ),
  }));
  function parameters(index, force = 0, kick = 0) {
    const k = (index * STRIDE) / 4;
    words[k] = sim.grainCount;
    words[k + 1] = MODE_COUNT;
    words[k + 2] = GRID;
    words[k + 3] = index;
    floats.set(
      [
        sim.step,
        sim.gravity,
        sim.friction,
        sim.restitution,
        sim.rollingFriction,
        force,
        hashCell,
        kick,
      ],
      k + 4,
    );
  }
  function dispatch(pass, name, groups, index = 0) {
    const stage = stages[name];
    pass.setPipeline(stage.pipeline);
    pass.setBindGroup(
      0,
      stage.groups[parity],
      stage.dynamic ? [index * STRIDE] : [],
    );
    pass.dispatchWorkgroups(groups);
  }
  function uploadParticles() {
    hashCell = 2 * Math.max(...sim.radii);
    const data = new Float32Array(sim.grainCount * 12);
    for (let i = 0; i < sim.grainCount; i++) {
      const k = i * 4,
        l = i * 3,
        stride = sim.grainCount * 4;
      data.set(sim.p.subarray(l, l + 3), k);
      data[k + 3] = sim.radii[i];
      data.set(sim.velocities.subarray(l, l + 3), stride + k);
      data[stride + k + 3] = 1 / sim.masses[i];
      data.set(sim.spin.subarray(l, l + 3), 2 * stride + k);
    }
    queue.writeBuffer(states[parity], 0, data);
  }
  function uploadModes() {
    const data = new Float32Array((MODE_COUNT + 1) * 12);
    for (let i = 0; i < MODE_COUNT; i++) {
      const mode = BASIS[i],
        m = sim.modal;
      data.set(
        [
          m.q[i],
          m.v[i],
          mode.omega,
          1 / mode.mass,
          m.gravityForce[i] / mode.mass,
          m.coupling[i] / mode.mass,
          ...m.matrix.subarray(i * 4, i * 4 + 4),
          sim.pickup[i],
          ((mode.m + Number(mode.sine)) % 2) + 2 * Number(mode.sine),
        ],
        i * 12,
      );
    }
    queue.writeBuffer(resources[3], 0, data);
    queue.writeBuffer(resources[5], 0, new Uint8Array(NODE_COUNT * 16));
  }
  function refresh(place = false, field = true) {
    parameters(0);
    queue.writeBuffer(uniform, 0, params, 0, STRIDE);
    const encoder = device.createCommandEncoder(),
      pass = encoder.beginComputePass();
    if (field) dispatch(pass, "field", Math.ceil((73 * 73) / 128));
    if (place) dispatch(pass, "place", Math.ceil(sim.grainCount / 128));
    dispatch(
      pass,
      "draw",
      Math.ceil(Math.max(sim.grainCount, NODE_COUNT) / 128),
    );
    pass.end();
    queue.submit([encoder.finish()]);
  }
  const oldScatter = sim.scatter.bind(sim),
    oldReset = sim.reset.bind(sim);
  // Particle radius scaling is applied by the caller before attaching the kernel.
  const originalRadii = Float64Array.from(sim.radii),
    originalMasses = Float64Array.from(sim.masses);
  sim.scatter = () => {
    oldScatter();
    sim.radii.set(originalRadii);
    sim.masses.set(originalMasses);
    for (let i = 0; i < sim.grainCount; i++)
      sim.sizes[i] = sim.radii[i] * WORLD_SCALE;
    uploadParticles();
    refresh(true, false);
  };
  sim.reset = () => {
    // reset() calls scatter(); perform the CPU reset before uploading either state.
    const scatter = sim.scatter;
    sim.scatter = oldScatter;
    oldReset();
    sim.scatter = scatter;
    sim.radii.set(originalRadii);
    sim.masses.set(originalMasses);
    for (let i = 0; i < sim.grainCount; i++)
      sim.sizes[i] = sim.radii[i] * WORLD_SCALE;
    kicks.fill(0);
    kickPending = false;
    uploadModes();
    uploadParticles();
    refresh(true);
  };
  sim.pluck = (x, z, strength = 1) => {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !Number.isFinite(strength) ||
      Math.hypot(x, z) > 2.94
    )
      return false;
    const impulse = -Math.max(0, Math.min(2, strength)) * 0.0004;
    for (let m = 0; m < MODE_COUNT; m++)
      kicks[m] +=
        (basisShape(m, x / WORLD_SCALE, z / WORLD_SCALE) * impulse) /
        BASIS[m].mass;
    kickPending = true;
    return true;
  };
  // CPU surface arrays are only inspection data; GPU draw buffers update in advance.
  sim.updateHeight = () => {};
  sim.advance = (dt) => {
    if (!Number.isFinite(dt) || dt < 0 || dt > 1)
      throw new RangeError("Time step must be between zero and one second.");
    if (disposed) return empty;
    sim.accumulator += dt * sim.speed;
    const steps = Math.floor((sim.accumulator + 1e-12) / sim.step);
    if (steps > MAX_STEPS)
      throw new RangeError("GPU batch exceeds two physical seconds.");
    sim.accumulator -= steps * sim.step;
    if (!steps) return empty;
    if (kickPending) queue.writeBuffer(resources[13], 0, kicks);
    const start = performance.now(),
      encoder = device.createCommandEncoder(),
      pass = encoder.beginComputePass();
    for (let s = 0; s < steps; s++) {
      if (sim.auto && sim.time >= sim.nextAt) sim.next();
      const phaseStep = 2 * Math.PI * sim.frequency * sim.step;
      parameters(
        s,
        sim.drive * Math.sin(sim.phase + phaseStep * 0.5),
        s === 0 && kickPending ? 1 : 0,
      );
      sim.phase = (sim.phase + phaseStep) % (2 * Math.PI);
      dispatch(pass, "modal", MODE_COUNT, s);
      dispatch(pass, "field", Math.ceil((73 * 73) / 128), s);
      dispatch(pass, "contact", Math.ceil(sim.grainCount / 64), s);
      dispatch(pass, "compact", Math.ceil(NODE_COUNT / 128), s);
      if (sim.collisions && sim.ticks % 2 === 0) {
        dispatch(pass, "clearHeads", 257, s);
        dispatch(pass, "buildHeads", Math.ceil(sim.grainCount / 128), s);
        dispatch(pass, "findNeighbors", Math.ceil(sim.grainCount / 128), s);
        for (let iteration = 0; iteration < 2; iteration++) {
          dispatch(pass, "collide", Math.ceil(sim.grainCount / 128), s);
          parity = 1 - parity;
        }
      }
      sim.ticks++;
      sim.time = sim.ticks * sim.step;
    }
    dispatch(
      pass,
      "draw",
      Math.ceil(Math.max(sim.grainCount, NODE_COUNT) / 128),
      steps - 1,
    );
    pass.end();
    queue.writeBuffer(uniform, 0, params, 0, steps * STRIDE);
    const slot = gpu.onAudio ? audioSlots.find((s) => !s.busy) : null;
    if (slot) {
      slot.busy = true;
      encoder.copyBufferToBuffer(resources[12], 0, slot.buffer, 0, steps * 4);
    }
    queue.submit([encoder.finish()]);
    inFlight++;
    stats.submittedSteps += steps;
    stats.lastBatchSteps = steps;
    queue
      .onSubmittedWorkDone()
      .then(() => {
        inFlight--;
        stats.lastBatchMs = performance.now() - start;
      })
      .catch(() => {
        inFlight--;
      });
    if (slot)
      slot.buffer
        .mapAsync(GPUMapMode.READ, 0, steps * 4)
        .then(() => {
          const samples = new Float32Array(
            slot.buffer.getMappedRange(0, steps * 4),
          ).slice();
          slot.buffer.unmap();
          slot.busy = false;
          if (!disposed) gpu.onAudio?.(samples, 1 / sim.step);
        })
        .catch(() => {
          slot.busy = false;
        });
    kickPending = false;
    kicks.fill(0);
    return empty;
  };
  async function readback() {
    const sizes = [
        sim.grainCount * 48,
        (MODE_COUNT + 1) * 48,
        NODE_COUNT * 16,
        4,
      ],
      sources = [states[parity], resources[3], resources[5], resources[7]],
      offsets = [0, 0, 0, 65536 * 4];
    const staging = sizes.map((size, i) =>
      device.createBuffer({
        label: `inspection ${i}`,
        size: Math.max(size, 4),
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    );
    const encoder = device.createCommandEncoder();
    for (let i = 0; i < sizes.length; i++)
      encoder.copyBufferToBuffer(
        sources[i],
        offsets[i],
        staging[i],
        0,
        sizes[i],
      );
    queue.submit([encoder.finish()]);
    await Promise.all(staging.map((b) => b.mapAsync(GPUMapMode.READ)));
    const packed = new Float32Array(staging[0].getMappedRange()),
      grains = new Float32Array(sim.grainCount * 12),
      modes = new Float32Array(staging[1].getMappedRange()).slice();
    const nodeData = staging[2].getMappedRange(),
      heights = new Float32Array(nodeData),
      impulses = new Int32Array(nodeData);
    for (let i = 0; i < sim.grainCount; i++) {
      const k = i * 12,
        l = i * 3,
        offset = i * 4,
        stride = sim.grainCount * 4;
      grains.set(packed.subarray(offset, offset + 4), k);
      grains.set(packed.subarray(stride + offset, stride + offset + 4), k + 4);
      grains.set(
        packed.subarray(2 * stride + offset, 2 * stride + offset + 4),
        k + 8,
      );
      sim.p.set(grains.subarray(k, k + 3), l);
      sim.velocities.set(grains.subarray(k + 4, k + 7), l);
      sim.spin.set(grains.subarray(k + 8, k + 11), l);
    }
    for (let m = 0; m < MODE_COUNT; m++) {
      let reaction = 0;
      for (let k = 0; k < NODE_COUNT; k++)
        reaction +=
          (impulses[k * 4 + 2] / 1e12) * sim.fields[k * MODE_COUNT + m];
      sim.modal.q[m] = modes[m * 12];
      sim.modal.v[m] = modes[m * 12 + 1] + reaction / BASIS[m].mass;
    }
    for (let k = 0; k < NODE_COUNT; k++)
      sim.height[k] = 0.21 + heights[k * 4] * 20;
    sim.syncRenderState(0);
    stats.maxContacts = new Int32Array(staging[3].getMappedRange())[0];
    staging.forEach((b) => {
      b.unmap();
      b.destroy();
    });
    return { grains, modes, stats: { ...stats } };
  }
  // Read-only inputs for the optional wave visualization. Its compute pass
  // has separate output storage and never writes back into the solver.
  const waveSource = { modes: resources[3], basis: resources[4] };
  const gpu = {
    drawAttribute,
    surfaceAttribute,
    waveSource,
    stats,
    readback,
    onAudio: null,
    get busy() {
      return inFlight > 0;
    },
    get queuedBatches() {
      return inFlight;
    },
    upload() {
      uploadModes();
      uploadParticles();
      refresh();
    },
    async idle() {
      await queue.onSubmittedWorkDone();
    },
  };
  sim.gpu = gpu;
  sim.dispose = () => {
    if (disposed) return;
    disposed = true;
    owned.forEach((b) => b.destroy());
    for (const attribute of [drawAttribute, surfaceAttribute]) {
      // Rendered attributes are registered with Three's disposal listeners;
      // standalone physics checks allocate through the backend only.
      attribute.dispose();
      if (renderer.backend.has(attribute))
        renderer.backend.destroyAttribute(attribute);
    }
  };
  uploadModes();
  uploadParticles();
  refresh();
  return gpu;
}
