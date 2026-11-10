import { DataUtils } from "three/webgpu";

export async function checkEnvironment(app = window.caustic) {
  const settings = { ...app.settings },
    before = app.inspect(),
    manual = app.manual;
  const sun = app.room.sun.intensity;
  const lights = [];
  app.scene.traverse((object) => {
    if (object.isLight) lights.push(object);
  });
  if (lights.length !== 1 || lights[0] !== app.room.sun)
    throw new Error("Redundant fill lights remain in the scene.");
  if (!app.scene.environment?.isPMREMTexture)
    throw new Error("The scene is missing a prefiltered environment.");
  const read = async (name) => {
    const rt = app.post.scenePass.renderTarget;
    return app.renderer.readRenderTargetPixelsAsync(
      rt,
      0,
      0,
      rt.width,
      rt.height,
      rt.textures.findIndex((t) => t.name === name),
    );
  };
  try {
    app.manual = true;
    app.pause(true);
    Object.assign(app.settings, {
      caustics: 0,
      fish: false,
      algae: false,
      orb: false,
    });
    app.room.sun.intensity = 0;
    const energy = [];
    let pixels = 0;
    for (const intensity of [0, 0.5, 1]) {
      app.settings.environmentIntensity = intensity;
      await new Promise(requestAnimationFrame);
      app.render();
      const color = await read("output"),
        surface = await read("diffuse");
      let sum = 0;
      pixels = 0;
      for (let i = 0; i < color.length; i += 4) {
        const kind = Math.floor(DataUtils.fromHalfFloat(surface[i + 3]) / 256);
        // Kind zero also labels the clear background; use definite receivers.
        if (kind !== 4) continue;
        for (let c = 0; c < 3; c++) {
          const value = DataUtils.fromHalfFloat(color[i + c]);
          if (!Number.isFinite(value) || value < 0)
            throw new Error("Invalid environment lighting.");
          sum += value;
        }
        pixels++;
      }
      if (pixels === 0) throw new Error("No stone receivers were rendered.");
      energy.push(sum / pixels);
    }
    if (energy[0] > 0.00001 || energy[1] < 0.01)
      throw new Error(
        "The environment does not independently illuminate the architecture.",
      );
    const ratio = energy[2] / energy[1];
    if (ratio < 1.95 || ratio > 2.05)
      throw new Error("Environment intensity is inconsistent.");
    return { passed: true, lightCount: lights.length, pixels, energy, ratio };
  } finally {
    app.room.sun.intensity = sun;
    Object.assign(app.settings, settings);
    app.pause(before.paused);
    app.manual = manual;
    app.post.invalidate();
    app.changed();
  }
}
