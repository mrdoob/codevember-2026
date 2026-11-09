import { BASIS, basisShape } from "../modes.js";
import { createWaveView } from "../wave-view.js";

// Isolated, deterministic visualization check. It borrows the live solver's
// read-only basis, but gives the visualization its own synthetic modal state.
export async function checkWaveView(app) {
  const wasManual = app.manual;
  app.manual = true;
  const device = app.renderer.backend.device;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  async function read(buffer, size) {
    const staging = device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(staging.getMappedRange()).slice();
    staging.unmap();
    staging.destroy();
    return data;
  }
  let wave, modesBuffer;
  try {
    await app.simulation.gpu.idle();
    const packed = new Float32Array((BASIS.length + 1) * 12);
    modesBuffer = device.createBuffer({
      size: packed.byteLength,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    const frequency = 192.5,
      omega = 2 * Math.PI * frequency;
    const selected = [
      BASIS.findIndex((m) => m.m === 2 && m.n === 2 && !m.sine),
      BASIS.findIndex((m) => m.m === 3 && m.n === 2 && m.sine),
    ];
    const coefficients = [
      [0.0003, -0.00012],
      [0.00007, 0.00018],
    ];
    const simulation = {
      time: 0,
      phase: 0,
      frequency,
      drive: 0.12,
      modal: { damping: 0.008 },
      gpu: {
        waveSource: {
          modes: modesBuffer,
          basis: app.simulation.gpu.waveSource.basis,
        },
      },
    };
    wave = await createWaveView(simulation, app.renderer);
    const settings = { view: "wave", waveHeight: 120, waveLight: 1 };
    const fieldBuffer = app.renderer.backend.get(wave.field).buffer;
    const shapeBuffer = app.renderer.backend.get(wave.shapeField).buffer;
    const displayBuffer = app.renderer.backend.get(wave.displayField).buffer;
    let maximumError = 0,
      reference;
    for (const phase of [0.2, 2.1, 5.7]) {
      packed.fill(0);
      BASIS.forEach((mode, i) => {
        const k = i * 12,
          index = selected.indexOf(i),
          [a, b] = index < 0 ? [0, 0] : coefficients[index];
        const gravityAcc = -0.8,
          rest = gravityAcc / (mode.omega * mode.omega);
        packed[k] = rest + a * Math.cos(phase) + b * Math.sin(phase);
        packed[k + 1] = omega * (-a * Math.sin(phase) + b * Math.cos(phase));
        packed[k + 2] = mode.omega;
        packed[k + 4] = gravityAcc;
        packed[k + 5] = index < 0 ? 0 : index === 0 ? 15 : -9;
        packed[k + 11] =
          ((mode.m + Number(mode.sine)) % 2) + 2 * Number(mode.sine);
      });
      device.queue.writeBuffer(modesBuffer, 0, packed);
      simulation.phase = phase;
      wave.setSimulation(simulation);
      wave.update(settings);
      const field = await read(fieldBuffer, 145 * 145 * 16);
      for (let z = 0; z < 145; z += 12)
        for (let x = 0; x < 145; x += 12) {
          const expected = [0, 0];
          selected.forEach((m, i) => {
            const b = basisShape(
              m,
              ((x - 72) * 0.3) / 144,
              ((z - 72) * 0.3) / 144,
            );
            expected[0] += coefficients[i][0] * b;
            expected[1] += coefficients[i][1] * b;
          });
          const k = (z * 145 + x) * 4;
          for (let c = 0; c < 2; c++) {
            maximumError = Math.max(
              maximumError,
              Math.abs(field[k + c] - expected[c]),
            );
            assert(
              Math.abs(field[k + c] - expected[c]) < 2e-9,
              "Envelope differs from analytical quadratures.",
            );
          }
          if (reference)
            for (let c = 0; c < 2; c++)
              assert(
                Math.abs(field[k + c] - reference[k + c]) < 2e-9,
                "Envelope changes with carrier phase.",
              );
        }
      const after = await read(modesBuffer, packed.byteLength);
      assert(
        after.every((v, i) => Object.is(v, packed[i])),
        "Visualization modified the modal state.",
      );
      reference = field;
    }
    const shape = await read(shapeBuffer, 145 * 145 * 16);
    const display = await read(displayBuffer, 145 * 145 * 16);
    for (let z = 0; z < 145; z += 12)
      for (let x = 0; x < 145; x += 12) {
        const expected = [0, 0];
        selected.forEach((m, i) => {
          const wn = packed[m * 12 + 2],
            w = Math.fround(omega),
            force = Math.fround(simulation.drive) * (i === 0 ? 15 : -9);
          const detuning = wn * wn - w * w,
            loss = 2 * Math.fround(simulation.modal.damping) * wn * w;
          const scale = force / (detuning * detuning + loss * loss),
            b = basisShape(m, ((x - 72) * 0.3) / 144, ((z - 72) * 0.3) / 144);
          expected[0] -= loss * scale * b;
          expected[1] += detuning * scale * b;
        });
        for (let c = 0; c < 2; c++)
          assert(
            Math.abs(shape[(z * 145 + x) * 4 + c] - expected[c]) < 2e-8,
            "Steady shape differs from the forced response.",
          );
      }
    // Perturb live modal motion while keeping the selected drive unchanged.
    // Fluid forcing follows it, but the displayed shape must be bit-identical.
    packed[selected[0] * 12] += 0.0005;
    device.queue.writeBuffer(modesBuffer, 0, packed);
    simulation.time += 0.1;
    wave.update(settings);
    const stable = await read(shapeBuffer, 145 * 145 * 16),
      live = await read(fieldBuffer, 145 * 145 * 16);
    assert(
      stable.every((v, i) => Object.is(v, shape[i])),
      "Live vibration moved the displayed shape.",
    );
    assert(
      live.some((v, i) => Math.abs(v - reference[i]) > 1e-7),
      "Fluid forcing did not follow live motion.",
    );
    const steadyDisplay = await read(displayBuffer, 145 * 145 * 16);
    assert(
      steadyDisplay.every((v, i) => i % 4 !== 2 || Object.is(v, display[i])),
      "Live motion vibrated the soap surface.",
    );
    simulation.time += 0.1;
    wave.update(settings, 0.55);
    const lowering = await read(displayBuffer, 145 * 145 * 16);
    assert(
      lowering.some((v, i) => i % 4 === 3 && v < -0.001),
      "Lowering the surface did not generate motion forcing.",
    );
    for (let i = 2; i < lowering.length; i += 4)
      assert(
        Math.abs(lowering[i] - display[i] * 0.55) < 1e-6,
        "Fluid height does not match the rendered view transition.",
      );
    simulation.time += 0.1;
    wave.update(settings, 1);
    const rising = await read(displayBuffer, 145 * 145 * 16);
    assert(
      rising.some((v, i) => i % 4 === 3 && v > 0.001),
      "Rising surface did not reverse motion forcing.",
    );
    reference = await read(fieldBuffer, 145 * 145 * 16);
    const filmSteps = wave.film.stats.steps;
    settings.waveHeight = 40;
    wave.update(settings);
    const unchanged = await read(fieldBuffer, 145 * 145 * 16);
    assert(
      unchanged.every((v, i) => Object.is(v, reference[i])),
      "Height adjustment changed the envelope field.",
    );
    const pausedDisplay = await read(displayBuffer, 145 * 145 * 16);
    assert(
      pausedDisplay.every((v, i) => i % 4 !== 3 || v === 0),
      "Paused height adjustment injected motion.",
    );
    assert(
      wave.film.stats.steps === filmSteps,
      "Paused height adjustment advanced the fluid.",
    );
    for (let i = 2; i < pausedDisplay.length; i += 4)
      assert(
        Math.abs(pausedDisplay[i] - display[i] / 3) < 1e-6,
        "Paused displayed height did not update.",
      );
    BASIS.forEach((mode, i) => {
      packed[i * 12] = packed[i * 12 + 4] / (mode.omega * mode.omega);
      packed[i * 12 + 1] = 0;
    });
    device.queue.writeBuffer(modesBuffer, 0, packed);
    wave.setSimulation(simulation);
    wave.update(settings);
    const resting = await read(fieldBuffer, 145 * 145 * 16);
    assert(
      Math.max(...resting.map(Math.abs)) < 1e-10,
      "Static sag appears as vibration.",
    );
    simulation.drive = 0;
    simulation.time += 1 / 60;
    wave.update(settings);
    const fading = await read(shapeBuffer, 145 * 145 * 16);
    assert(
      fading.some((v) => Math.abs(v) > 1e-8) &&
        fading.some((v, i) => v !== shape[i]),
      "Shape change did not interpolate.",
    );
    for (let i = 0; i < 17; i++) {
      simulation.time += 0.1;
      wave.update(settings);
    }
    const flat = await read(shapeBuffer, 145 * 145 * 16);
    assert(
      flat.every((v) => v === 0),
      "Steady shape did not settle after stopping the drive.",
    );
    return {
      passed: true,
      checks: [
        "analytical quadratures and boundary",
        "carrier phase invariance",
        "read-only solver state",
        "paused height adjustment",
        "static sag removal",
        "steady forced shape",
        "motionless shape with live fluid forcing",
        "shared display and fluid height",
        "signed elevation motion",
        "paused fluid isolation",
        "smooth shape transition",
      ],
      maximumError,
    };
  } finally {
    await device.queue.onSubmittedWorkDone();
    wave?.dispose();
    modesBuffer?.destroy();
    app.manual = wasManual;
  }
}
