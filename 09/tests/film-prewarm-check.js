import { BASIS } from "../modes.js";
import { createWaveView } from "../wave-view.js";

// Exercise startup with separate film buffers and read-only physical inputs.
export async function checkFilmPrewarm(app) {
  const wasManual = app.manual;
  app.manual = true;
  const device = app.renderer.backend.device;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const difference = (a, b) =>
    Math.sqrt(
      a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length,
    );
  async function readModes() {
    const size = (BASIS.length + 1) * 48;
    const staging = device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      app.simulation.gpu.waveSource.modes,
      0,
      staging,
      0,
      size,
    );
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(staging.getMappedRange()).slice();
    staging.unmap();
    staging.destroy();
    return bytes;
  }
  let wave;
  try {
    await app.simulation.gpu.idle();
    const originalTime = app.simulation.time;
    const originalPhase = app.simulation.phase;
    const modes = await readModes();
    const simulation = {
      time: originalTime,
      phase: originalPhase,
      frequency: 223.2,
      drive: 0.12,
      modal: { damping: 0.008 },
      gpu: app.simulation.gpu,
    };
    const settings = {
      view: "wave",
      waveHeight: 100,
      waveLight: 2,
      filmStirring: 1,
    };
    wave = await createWaveView(simulation, app.renderer);
    const initial = await wave.film.readback();
    const start = performance.now();
    await wave.prewarm(settings);
    const durationMs = performance.now() - start;
    const opening = await wave.film.readback();
    const displacement = difference(opening.thickness, initial.thickness);
    assert(displacement > 1, "Startup did not transport the film thickness.");
    assert(
      opening.velocity.some((value) => Math.abs(value) > 0.001),
      "Startup film has no flow.",
    );
    assert(
      opening.velocity.every(Number.isFinite) &&
        opening.thickness.every(Number.isFinite),
      "Nonfinite startup film.",
    );
    const min = Math.min(...initial.thickness),
      max = Math.max(...initial.thickness);
    assert(
      opening.thickness.every(
        (value) => value >= min - 0.01 && value <= max + 0.01,
      ),
      "Startup introduced thickness extrema.",
    );
    assert(
      opening.stats.steps === 480,
      "Startup did not use eight seconds at 60 Hz.",
    );
    wave.update(settings);
    assert(
      wave.film.stats.steps === opening.stats.steps,
      "First render advanced the prepared film.",
    );

    simulation.frequency = 192.5;
    await wave.prewarm(settings);
    const alternate = await wave.film.readback();
    const resonanceDifference = difference(
      alternate.thickness,
      opening.thickness,
    );
    assert(
      resonanceDifference > 1,
      "Startup pattern did not follow the selected resonance.",
    );
    const afterModes = await readModes();
    assert(
      afterModes.every((value, i) => value === modes[i]),
      "Film startup modified the physical modes.",
    );
    assert(
      app.simulation.time === originalTime &&
        app.simulation.phase === originalPhase,
      "Film startup advanced physical time.",
    );

    wave.reset();
    const reset = await wave.film.readback();
    assert(
      reset.stats.steps === 0 && reset.velocity.every((value) => value === 0),
      "Reset retained startup flow.",
    );
    assert(
      difference(reset.thickness, initial.thickness) === 0,
      "Reset did not restore the fresh film.",
    );
    return {
      passed: true,
      durationMs,
      displacement,
      resonanceDifference,
      steps: opening.stats.steps,
    };
  } finally {
    await device.queue.onSubmittedWorkDone();
    wave?.dispose();
    app.manual = wasManual;
  }
}
