import { StorageBufferAttribute } from "three/webgpu";
import { createFilmFluid, FILM_GRID, FILM_STEP } from "../film-fluid.js";

// Isolated GPU checks: synthetic wave input, no writes to the live simulation.
export async function checkFilmFluid(app) {
  const wasManual = app.manual;
  app.manual = true;
  const renderer = app.renderer,
    device = renderer.backend.device,
    n = FILM_GRID,
    count = n * n;
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const inside = (x, y) =>
    x >= 0 &&
    y >= 0 &&
    x < n &&
    y < n &&
    (((x + 0.5) * 2) / n - 1) ** 2 + (((y + 0.5) * 2) / n - 1) ** 2 < 1;
  const rmsDivergence = (v) => {
    let sum = 0,
      cells = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (inside(x, y)) {
          const k = y * n + x,
            d =
              (v[k * 2] -
                (inside(x - 1, y) ? v[(k - 1) * 2] : 0) +
                v[k * 2 + 1] -
                (inside(x, y - 1) ? v[(k - n) * 2 + 1] : 0)) *
              n *
              0.5;
          sum += d * d;
          cells++;
        }
    return Math.sqrt(sum / cells);
  };
  const mass = (h) => {
    let sum = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (inside(x, y)) sum += h[y * n + x];
    return sum;
  };
  const difference = (a, b) =>
    Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length);
  const envelope = new StorageBufferAttribute(145 * 145, 4);
  renderer.backend.createStorageAttribute(envelope);
  let film;
  try {
    await app.simulation.gpu.idle();
    const wave = new Float32Array(145 * 145 * 4);
    for (let y = 0; y < 145; y++)
      for (let x = 0; x < 145; x++) {
        const px = (x - 72) / 72,
          py = (y - 72) / 72,
          r2 = px * px + py * py;
        wave[(y * 145 + x) * 4] =
          r2 < 1 ? 0.0002 * Math.sin(px * 5) * Math.cos(py * 4) * (1 - r2) : 0;
      }
    const source = renderer.backend.get(envelope).buffer;
    device.queue.writeBuffer(source, 0, wave);
    film = await createFilmFluid(renderer, envelope);
    const initial = await film.readback();
    for (let i = 0; i < 60; i++) film.advance(FILM_STEP, 0);
    const still = await film.readback(),
      stationaryError = difference(initial.thickness, still.thickness);
    assert(
      still.velocity.every((v) => v === 0),
      "Unforced film gained velocity.",
    );
    assert(stationaryError < 0.001, "Stationary film thickness changed.");

    const velocity = new Float32Array(count * 2);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (inside(x, y)) {
          const k = y * n + x;
          if (inside(x + 1, y))
            velocity[k * 2] = 0.2 * Math.sin(x * 1.1 + y * 0.3);
          if (inside(x, y + 1))
            velocity[k * 2 + 1] = 0.2 * Math.cos(y * 0.8 - x * 0.5);
        }
    film.upload({ velocity });
    const before = rmsDivergence(velocity);
    film.project();
    const projected = await film.readback(),
      after = rmsDivergence(projected.velocity);
    assert(
      after < before * 0.1,
      "Pressure projection did not remove divergence.",
    );

    film.reset();
    for (let i = 0; i < 600; i++) film.advance(FILM_STEP, 1);
    const moving = await film.readback();
    let min = Infinity,
      max = -Infinity,
      speed = 0;
    for (let k = 0; k < count; k++) {
      min = Math.min(min, moving.thickness[k]);
      max = Math.max(max, moving.thickness[k]);
      speed = Math.max(
        speed,
        Math.hypot(moving.velocity[k * 2], moving.velocity[k * 2 + 1]),
      );
      const x = k % n,
        y = Math.floor(k / n);
      if (!inside(x, y) || !inside(x + 1, y))
        assert(moving.velocity[k * 2] === 0, "Flow escaped the rim in x.");
      if (!inside(x, y) || !inside(x, y + 1))
        assert(moving.velocity[k * 2 + 1] === 0, "Flow escaped the rim in y.");
    }
    const moved = difference(initial.thickness, moving.thickness),
      massDrift = Math.abs(
        mass(moving.thickness) / mass(initial.thickness) - 1,
      );
    assert(
      moving.velocity.every(Number.isFinite) &&
        moving.thickness.every(Number.isFinite),
      "Non-finite film state.",
    );
    assert(
      min >= Math.min(...initial.thickness) - 0.001 &&
        max <= Math.max(...initial.thickness) + 0.001,
      "Advection created thickness extrema.",
    );
    assert(speed > 0.01 && moved > 1, "Resonance did not stir the film.");
    assert(massDrift < 0.03, "Film transport lost too much average thickness.");
    const steps = film.stats.steps;
    film.advance(0, 1);
    const paused = await film.readback();
    assert(
      film.stats.steps === steps &&
        difference(paused.thickness, moving.thickness) === 0,
      "Paused film changed.",
    );

    film.reset();
    for (let i = 0; i < 60; i++) film.advance(FILM_STEP, 1);
    const sixty = await film.readback();
    film.reset();
    for (let i = 0; i < 30; i++) film.advance(FILM_STEP * 2, 1);
    const thirty = await film.readback();
    assert(
      difference(sixty.thickness, thirty.thickness) === 0 &&
        difference(sixty.velocity, thirty.velocity) === 0,
      "Film depends on render frame rate.",
    );
    const staging = device.createBuffer({
      size: wave.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, staging, 0, wave.byteLength);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const unchanged = new Float32Array(staging.getMappedRange()).every((v, i) =>
      Object.is(v, wave[i]),
    );
    staging.unmap();
    staging.destroy();
    assert(unchanged, "Fluid modified the membrane envelope.");
    // Isolate the new elevation coupling: no resonance energy in xy.
    wave.fill(0);
    for (let y = 0; y < 145; y++)
      for (let x = 0; x < 145; x++) {
        const px = (x - 72) / 72,
          py = (y - 72) / 72,
          r2 = px * px + py * py;
        if (r2 < 1)
          wave[(y * 145 + x) * 4 + 2] = 0.35 * (1 - r2) * (1 + 0.3 * px);
      }
    device.queue.writeBuffer(source, 0, wave);
    film.reset();
    for (let i = 0; i < 60; i++) film.advance(FILM_STEP, 3);
    const staticHeight = await film.readback();
    assert(
      staticHeight.velocity.every((v) => v === 0),
      "Static elevation stirred the film.",
    );
    for (let y = 0; y < 145; y++)
      for (let x = 0; x < 145; x++) {
        const px = (x - 72) / 72,
          py = (y - 72) / 72,
          r2 = px * px + py * py;
        if (r2 < 1)
          wave[(y * 145 + x) * 4 + 3] =
            0.4 * (1 - r2) * Math.sin(px * 4 + py * 3);
      }
    device.queue.writeBuffer(source, 0, wave);
    film.reset();
    for (let i = 0; i < 240; i++) film.advance(FILM_STEP, 3);
    const motion = await film.readback(),
      motionChange = difference(initial.thickness, motion.thickness);
    assert(
      motion.velocity.every(Number.isFinite) &&
        motion.thickness.every(Number.isFinite),
      "Elevation forcing became non-finite.",
    );
    assert(
      motionChange > 0.1 && motion.velocity.some((v) => Math.abs(v) > 0.001),
      "Elevation motion did not perturb the fluid.",
    );
    assert(
      Math.min(...motion.thickness) >= Math.min(...initial.thickness) - 0.001 &&
        Math.max(...motion.thickness) <= Math.max(...initial.thickness) + 0.001,
      "Elevation forcing created thickness extrema.",
    );
    return {
      passed: true,
      stationaryError,
      projection: { before, after },
      flow: {
        speed,
        thicknessChangeRMS: moved,
        min,
        max,
        massDrift,
        divergence: rmsDivergence(moving.velocity),
      },
      motion: { thicknessChangeRMS: motionChange },
      checks: [
        "stationary unforced film",
        "pressure projection",
        "closed rim",
        "resonance-driven transport",
        "bounded finite thickness",
        "paused state",
        "fixed time step",
        "read-only membrane input",
        "static height has no forcing",
        "elevation-driven transport",
      ],
    };
  } finally {
    await device.queue.onSubmittedWorkDone();
    film?.dispose();
    envelope.dispose();
    if (renderer.backend.has(envelope))
      renderer.backend.destroyAttribute(envelope);
    app.manual = wasManual;
  }
}
