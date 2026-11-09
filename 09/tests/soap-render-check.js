import * as THREE from "three/webgpu";
import { mrt, output, emissive } from "three/tsl";
import { createWaveView } from "../wave-view.js";
import { soapReflectanceRGB } from "../soap-optics.js";

// Exercise the production material, lookup and framebuffer transmission path.
export async function checkSoapRendering(app) {
  const renderer = app.renderer,
    wasManual = app.manual;
  const saved = {
    target: renderer.getRenderTarget(),
    mrt: renderer.getMRT(),
    tone: renderer.toneMapping,
    colorSpace: renderer.outputColorSpace,
  };
  app.manual = true;
  let wave, environment, target, generator;
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  try {
    await app.simulation.gpu.idle();
    const room = new THREE.Scene();
    room.background = new THREE.Color(1, 1, 1);
    generator = new THREE.PMREMGenerator(renderer);
    environment = generator.fromScene(room);
    wave = await createWaveView(app.simulation, renderer);
    wave.material.envMap = environment.texture;
    const scene = new THREE.Scene(),
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    camera.position.set(0, 5, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0.21, 0);
    scene.add(wave.mesh);
    target = new THREE.RenderTarget(64, 64, {
      count: 2,
      type: THREE.HalfFloatType,
      samples: 4,
    });
    target.textures[0].name = "output";
    target.textures[1].name = "emissive";
    renderer.setRenderTarget(target);
    renderer.setMRT(mrt({ output, emissive }));
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const settings = { view: "wave", waveHeight: 0, waveLight: 1 / 0.8 };
    wave.update(settings); // A uniform white environment gives unit illumination.
    const results = [];
    async function capture(thickness, background, lighting = 1 / 0.8) {
      wave.film.upload({
        thickness: new Float32Array(wave.film.size ** 2).fill(thickness),
      });
      settings.waveLight = lighting;
      wave.update(settings);
      scene.background = new THREE.Color().setRGB(
        ...background,
        THREE.LinearSRGBColorSpace,
      );
      renderer.render(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        64,
        64,
      );
      return [0, 1, 2].map((c) =>
        THREE.DataUtils.fromHalfFloat(pixels[(32 * 64 + 32) * 4 + c]),
      );
    }
    for (const thickness of [0, 120, 380, 650, 880]) {
      const white = await capture(thickness, [1, 1, 1]);
      assert(
        white.every((v) => Math.abs(v - 1) < 0.004),
        `White furnace gained or lost energy at ${thickness} nm: ${white}.`,
      );
      const black = await capture(thickness, [0, 0, 0]),
        expected = soapReflectanceRGB(thickness, 1);
      assert(
        black.every((v, i) => Math.abs(v - expected[i]) < 0.003),
        `GPU reflection differs from spectral optics: ${black} vs ${expected}.`,
      );
      results.push({ thickness, white, black, expected });
    }
    const background = [0.2, 0.4, 0.7],
      R = soapReflectanceRGB(380, 1),
      dark = await capture(380, background, 0);
    assert(
      dark.every((v, i) => Math.abs(v - background[i] * (1 - R[i])) < 0.004),
      "Transmission or zero-light behavior is incorrect.",
    );
    return {
      passed: true,
      checks: [
        "white furnace energy",
        "spectral reflection",
        "zero thickness transparency",
        "complementary RGB transmission",
        "no emitted light",
      ],
      results,
      dark,
    };
  } finally {
    renderer.setRenderTarget(saved.target);
    renderer.setMRT(saved.mrt);
    renderer.toneMapping = saved.tone;
    renderer.outputColorSpace = saved.colorSpace;
    await renderer.backend.device.queue.onSubmittedWorkDone();
    wave?.dispose();
    environment?.dispose();
    generator?.dispose();
    target?.dispose();
    app.manual = wasManual;
  }
}
