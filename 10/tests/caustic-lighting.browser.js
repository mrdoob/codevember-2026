import { DataUtils } from "three/webgpu";
import { Fn, uniform } from "three/tsl";

// Verify redistribution of actual direct lighting, including complete shadows.
export async function checkCausticLighting(app = window.caustic) {
  const settings = { ...app.settings },
    state = app.inspect(),
    manual = app.manual,
    material = app.room.floorMaterial,
    receivedShadow = material.receivedShadowNode;
  const visibility = uniform(1);
  const read = async (name) => {
    const rt = app.post.scenePass.renderTarget;
    return Float32Array.from(
      await app.renderer.readRenderTargetPixelsAsync(
        rt,
        0,
        0,
        rt.width,
        rt.height,
        rt.textures.findIndex((t) => t.name === name),
      ),
      DataUtils.fromHalfFloat,
    );
  };
  try {
    app.manual = true;
    app.pause(true);
    Object.assign(app.settings, {
      fish: false,
      algae: false,
      orb: false,
      particles: false,
    });
    material.receivedShadowNode = Fn(([shadow]) => shadow.mul(visibility));
    material.needsUpdate = true;
    const result = {};
    for (const amount of [0, 1]) {
      visibility.value = amount;
      const frames = [];
      for (const strength of [0, 1]) {
        app.settings.caustics = strength;
        app.changed();
        for (let i = 0; i < 3; i++) {
          await new Promise(requestAnimationFrame);
          app.render();
        }
        frames.push(await read("output"));
      }
      const surface = await read("diffuse");
      let pixels = 0,
        brighter = 0,
        darker = 0,
        difference = 0,
        maximum = 0;
      for (let i = 0; i < surface.length; i += 4) {
        if (Math.floor(surface[i + 3] / 256) !== 4) continue;
        const delta =
          (frames[1][i] +
            frames[1][i + 1] +
            frames[1][i + 2] -
            frames[0][i] -
            frames[0][i + 1] -
            frames[0][i + 2]) /
          3;
        if (!Number.isFinite(delta))
          throw new Error("Invalid caustic lighting.");
        difference += Math.abs(delta);
        maximum = Math.max(maximum, Math.abs(delta));
        if (delta > 0.02) brighter++;
        if (delta < -0.02) darker++;
        pixels++;
      }
      result[amount ? "lit" : "shadowed"] = {
        pixels,
        brighter,
        darker,
        meanDifference: difference / pixels,
        maximum,
      };
    }
    if (result.shadowed.maximum > 0.001)
      throw new Error("Caustics remain visible in a fully opaque shadow.");
    if (result.lit.brighter < 100 || result.lit.darker < 100)
      throw new Error("Caustics do not both focus and spread direct light.");
    return { passed: true, ...result };
  } finally {
    material.receivedShadowNode = receivedShadow;
    material.needsUpdate = true;
    Object.assign(app.settings, settings);
    app.pause(state.paused);
    app.manual = manual;
    app.room.sun.shadow.needsUpdate = true;
    app.post.invalidate();
    app.changed();
  }
}
