import { DataUtils } from "three/webgpu";
import { floorHeight } from "../architecture.js";
import { WATER_HEIGHT } from "../motion.js";
import { SCHOOL_FISH_COUNT } from "../fish-schools.js";

export async function checkMarine(app = window.caustic) {
  const settings = { ...app.settings },
    before = app.inspect(),
    manual = app.manual;
  const fish = app.marine.fish,
    cast = fish.castShadow;
  const range = [Infinity, -Infinity];
  try {
    app.manual = true;
    app.pause(true);
    app.settings.fish = true;
    for (let t = 0; t < 44; t += 2) {
      app.marine.update(t, app.settings);
      const m = fish.instanceMatrix.array;
      for (let i = 0; i < SCHOOL_FISH_COUNT; i++) {
        const x = m[i * 16 + 12],
          y = m[i * 16 + 13],
          z = m[i * 16 + 14];
        if (y < floorHeight(Math.hypot(x, z)) + 0.3 || y > WATER_HEIGHT - 0.2)
          throw new Error(
            "A school crossed the architecture or water surface.",
          );
        range[0] = Math.min(range[0], y);
        range[1] = Math.max(range[1], y);
      }
    }
    if (range[1] - range[0] < 3)
      throw new Error("Schools do not explore the full depth.");
    Object.assign(app.settings, { caustics: 0, ssr: false });
    const read = async (name) => {
      const rt = app.post.scenePass.renderTarget;
      const data = await app.renderer.readRenderTargetPixelsAsync(
        rt,
        0,
        0,
        rt.width,
        rt.height,
        rt.textures.findIndex((t) => t.name === name),
      );
      return Float32Array.from(data, DataUtils.fromHalfFloat);
    };
    const values = [];
    for (const enabled of [false, true]) {
      fish.castShadow = enabled;
      app.room.sun.shadow.needsUpdate = true;
      app.changed();
      for (let i = 0; i < 3; i++) {
        await new Promise(requestAnimationFrame);
        app.render();
      }
      values.push(await read("output"));
    }
    const surface = await read("diffuse");
    let shadowPixels = 0,
      reduction = 0;
    for (let i = 0; i < surface.length / 4; i++) {
      if (Math.floor(surface[i * 4 + 3] / 256) !== 4) continue;
      const delta = values[0][i * 4] - values[1][i * 4];
      if (delta > 0.03) {
        shadowPixels++;
        reduction += delta;
      }
    }
    if (shadowPixels < 100)
      throw new Error(`Fish shadows missing: ${shadowPixels} receiver pixels.`);
    return {
      passed: true,
      heightRange: range,
      shadowPixels,
      meanReduction: reduction / shadowPixels,
    };
  } finally {
    fish.castShadow = cast;
    app.room.sun.shadow.needsUpdate = true;
    Object.assign(app.settings, settings);
    app.marine.update(before.time, settings);
    app.pause(before.paused);
    app.manual = manual;
    app.post.invalidate();
    app.changed();
  }
}
