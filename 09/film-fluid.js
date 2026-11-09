import { StorageBufferAttribute } from "three/webgpu";

export const FILM_GRID = 256,
  FILM_STEP = 1 / 60;

export async function createFilmFluid(
  renderer,
  envelope,
  { size = FILM_GRID, pressureIterations = 40 } = {},
) {
  const device = renderer.backend.device,
    count = size * size,
    bytes = count * 4,
    owned = [];
  const buffer = (label, length, usage) => {
    const value = device.createBuffer({ label, size: length, usage });
    owned.push(value);
    return value;
  };
  const storage = (label, length) =>
    buffer(
      label,
      length,
      GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    );
  const params = buffer(
    "film fluid parameters",
    16,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const velocity = storage("film velocity", bytes * 2),
    provisional = storage("unprojected film velocity", bytes * 2);
  const thickness = [
    storage("film thickness A", bytes),
    storage("film thickness B", bytes),
  ];
  const predictor = storage("advected film predictor", bytes),
    divergence = storage("film divergence", bytes);
  const curl = storage("film vorticity", bytes);
  const pressure = [
    storage("film pressure A", bytes),
    storage("film pressure B", bytes),
  ];
  const attribute = new StorageBufferAttribute(count, 1);
  renderer.backend.createStorageAttribute(attribute);
  const display = renderer.backend.get(attribute).buffer,
    wave = renderer.backend.get(envelope).buffer;
  const response = await fetch(new URL("./film-fluid.wgsl", import.meta.url));
  if (!response.ok) throw new Error("Film fluid solver could not be loaded.");
  const module = device.createShaderModule({
    label: "soap film fluid",
    code: await response.text(),
  });
  const info = await module.getCompilationInfo(),
    errors = info.messages.filter((m) => m.type === "error");
  if (errors.length)
    throw new Error(
      errors
        .map((m) => `film-fluid.wgsl:${m.lineNum}: ${m.message}`)
        .join("\n"),
    );
  const stages = {};
  async function stage(name, mappings) {
    const pipeline = await device.createComputePipelineAsync({
      label: `film ${name}`,
      layout: "auto",
      compute: { module, entryPoint: name, constants: { N: size } },
    });
    const groups = mappings.map((mapping) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: Object.entries(mapping).map(([binding, value]) => ({
          binding: Number(binding),
          resource: { buffer: value },
        })),
      }),
    );
    stages[name] = { pipeline, groups };
  }
  await stage("initialize", [{ 2: velocity, 4: thickness[0], 6: pressure[0] }]);
  await stage("computeCurl", [{ 1: velocity, 10: curl }]);
  await stage(
    "advectVelocity",
    thickness.map((f) => ({
      0: params,
      1: velocity,
      2: provisional,
      3: f,
      8: wave,
      10: curl,
    })),
  );
  await stage("computeDivergence", [{ 1: provisional, 7: divergence }]);
  await stage(
    "solvePressure",
    pressure.map((p, i) => ({ 5: p, 6: pressure[1 - i], 7: divergence })),
  );
  await stage("project", [
    { 1: provisional, 2: velocity, 5: pressure[pressureIterations % 2] },
  ]);
  // Both scalar sources are referenced by one WGSL helper. Bind an unused
  // thickness buffer to its reverse sampler so the predictor never aliases it.
  await stage(
    "advectFilm",
    thickness.map((f, i) => ({
      0: params,
      1: velocity,
      3: f,
      4: predictor,
      9: thickness[1 - i],
    })),
  );
  await stage(
    "correctFilm",
    thickness.map((f, i) => ({
      0: params,
      1: velocity,
      3: f,
      4: thickness[1 - i],
      9: predictor,
    })),
  );
  let parity = 0,
    accumulator = 0;
  const stats = { steps: 0, simulatedTime: 0 };
  function dispatch(pass, name, index = 0) {
    const stage = stages[name];
    pass.setPipeline(stage.pipeline);
    pass.setBindGroup(0, stage.groups[index]);
    pass.dispatchWorkgroups(Math.ceil(count / 128));
  }
  function projection(pass) {
    dispatch(pass, "computeDivergence");
    for (let i = 0; i < pressureIterations; i++)
      dispatch(pass, "solvePressure", i % 2);
    dispatch(pass, "project");
  }
  function reset() {
    parity = 0;
    accumulator = 0;
    stats.steps = 0;
    stats.simulatedTime = 0;
    const encoder = device.createCommandEncoder(),
      pass = encoder.beginComputePass();
    dispatch(pass, "initialize");
    pass.end();
    encoder.copyBufferToBuffer(thickness[0], 0, thickness[1], 0, bytes);
    encoder.copyBufferToBuffer(thickness[0], 0, display, 0, bytes);
    device.queue.submit([encoder.finish()]);
  }
  function encode(encoder, elapsed, stirring = 1) {
    accumulator += Math.min(Math.max(elapsed, 0), 0.1);
    const steps = Math.min(6, Math.floor((accumulator + 1e-10) / FILM_STEP));
    accumulator -= steps * FILM_STEP;
    if (!steps) return;
    device.queue.writeBuffer(
      params,
      0,
      new Float32Array([FILM_STEP, stirring, 0.000035, 0.1]),
    );
    const pass = encoder.beginComputePass({ label: "soap film flow" });
    for (let i = 0; i < steps; i++) {
      dispatch(pass, "computeCurl");
      dispatch(pass, "advectVelocity", parity);
      projection(pass);
      dispatch(pass, "advectFilm", parity);
      dispatch(pass, "correctFilm", parity);
      parity = 1 - parity;
    }
    pass.end();
    encoder.copyBufferToBuffer(thickness[parity], 0, display, 0, bytes);
    stats.steps += steps;
    stats.simulatedTime = stats.steps * FILM_STEP;
  }
  function advance(elapsed, stirring = 1) {
    const encoder = device.createCommandEncoder();
    encode(encoder, elapsed, stirring);
    device.queue.submit([encoder.finish()]);
  }
  async function readback() {
    const staging = device.createBuffer({
      size: bytes * 3,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(velocity, 0, staging, 0, bytes * 2);
    encoder.copyBufferToBuffer(thickness[parity], 0, staging, bytes * 2, bytes);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const packed = new Float32Array(staging.getMappedRange()).slice();
    staging.unmap();
    staging.destroy();
    return {
      velocity: packed.slice(0, count * 2),
      thickness: packed.slice(count * 2),
      size,
      stats: { ...stats },
    };
  }
  // Explicit inspection helpers also support deterministic isolated checks.
  function upload({ velocity: v, thickness: h }) {
    if (v) {
      if (v.length !== count * 2)
        throw new Error("Incorrect film velocity size.");
      device.queue.writeBuffer(velocity, 0, v);
    }
    if (h) {
      if (h.length !== count) throw new Error("Incorrect film thickness size.");
      device.queue.writeBuffer(thickness[parity], 0, h);
      device.queue.writeBuffer(display, 0, h);
    }
  }
  function project() {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(velocity, 0, provisional, 0, bytes * 2);
    const pass = encoder.beginComputePass();
    projection(pass);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  reset();
  return {
    attribute,
    size,
    stats,
    encode,
    advance,
    reset,
    readback,
    upload,
    project,
    dispose() {
      owned.forEach((b) => b.destroy());
      attribute.dispose();
      if (renderer.backend.has(attribute))
        renderer.backend.destroyAttribute(attribute);
    },
  };
}
