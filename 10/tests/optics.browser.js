import { DataUtils, REVISION } from "three/webgpu";
import { createOptics } from "../optics.js";

export async function checkOptics(app = window.caustic) {
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  assert(
    REVISION === "188dev" && app.renderer.backend.isWebGPUBackend,
    "Expected native Three.js WebGPU at the pinned SVGF development build.",
  );
  const manual = app.manual;
  app.manual = true;
  const optics = createOptics(),
    renderer = app.renderer;
  const stats = [];
  async function sample(target, size = 192) {
    const data = await renderer.readRenderTargetPixelsAsync(
      target,
      (target.width - size) / 2,
      (target.height - size) / 2,
      size,
      size,
    );
    const values = Float32Array.from(data, DataUtils.fromHalfFloat);
    assert(
      values.every(Number.isFinite),
      "Photon map contains invalid radiance.",
    );
    let mean = 0,
      square = 0,
      chroma = 0;
    const power = [0, 0, 0];
    for (let i = 0; i < values.length; i += 4) {
      mean += values[i];
      square += values[i] ** 2;
      chroma += Math.abs(values[i] - values[i + 2]);
      for (let band = 0; band < 3; band++) power[band] += values[i + band];
    }
    const count = values.length / 4;
    mean /= count;
    return {
      values,
      mean,
      variance: square / count - mean ** 2,
      chroma: chroma / count,
      power: power.map((value) => value / count),
    };
  }
  try {
    optics.sun.value.copy(app.optics.sun.value);
    optics.amplitude.value = 0;
    optics.dispersion.value = 0;
    optics.render(renderer);
    const flat = await sample(optics.waterMap, optics.waterMap.width);
    assert(
      Math.abs(flat.mean - 0.22) < 0.003 && flat.variance < 0.00001,
      "A flat interface should preserve uniform irradiance.",
    );
    optics.amplitude.value = 1;
    optics.render(renderer);
    const { mean: focusedPower } = await sample(
      optics.waterMap,
      optics.waterMap.width,
    );
    const energyRatio = focusedPower / flat.mean;
    assert(
      energyRatio > 0.9 && energyRatio < 1.03,
      "Focusing created or lost excessive light across the periodic receiver.",
    );
    const wave = await sample(optics.waterMap);
    assert(wave.variance > 0.002, "Curved water did not concentrate photons.");
    assert(
      wave.chroma < 0.00001,
      "Zero dispersion should give coincident RGB rays.",
    );
    optics.dispersion.value = 1;
    optics.render(renderer);
    const spectral = await sample(optics.waterMap);
    assert(
      spectral.chroma > 0.002,
      "Dispersion did not separate the color channels.",
    );
    const spectralPower = (await sample(optics.waterMap, optics.waterMap.width))
      .power;
    assert(
      spectralPower.every(
        (value) => value / flat.mean > 0.9 && value / flat.mean < 1.03,
      ),
      "Spectral reconstruction changed the white-light energy balance.",
    );
    const low = await sample(optics.orbMap, 512);
    optics.center.value.y = 3.5;
    optics.render(renderer);
    const high = await sample(optics.orbMap, 512);
    let difference = 0;
    for (let i = 0; i < low.values.length; i += 4)
      difference += Math.abs(low.values[i] - high.values[i]);
    difference /= low.values.length / 4;
    assert(difference > 0.01, "Raising the lens did not change its caustic.");
    for (const [name, value] of Object.entries({
      flat,
      wave,
      spectral,
      low,
      high,
    }))
      stats.push({
        name,
        mean: value.mean,
        variance: value.variance,
        chroma: value.chroma,
      });
    return {
      passed: true,
      checks: 7,
      energyRatio,
      spectralPower,
      focusDifference: difference,
      stats,
    };
  } finally {
    optics.dispose();
    app.manual = manual;
    app.changed();
  }
}
