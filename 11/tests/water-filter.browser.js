import {
  DataTexture,
  DataUtils,
  FloatType,
  LinearFilter,
  RGBAFormat,
  RenderPipeline,
} from "three/webgpu";
import { texture, uniform } from "three/tsl";
import { createWaterBlur } from "../water-blur.js";

// A single bright texel exposes repeated highlights from widely spaced blur
// taps. Its filtered profile must decrease smoothly, even at maximum softness.
export async function checkWaterFilter(app = window.rust) {
  const manual = app.manual;
  const target = app.post.composite.renderTarget;
  const width = target.width,
    height = target.height;
  const x = Math.floor(width / 2),
    y = Math.floor(height / 2);
  const pixels = new Float32Array(width * height * 4);
  pixels[(y * width + x) * 4] = 1;
  const source = new DataTexture(pixels, width, height, RGBAFormat, FloatType);
  source.minFilter = source.magFilter = LinearFilter;
  source.needsUpdate = true;
  const distances = new Float32Array(width * 4).fill(1);
  const depth = new DataTexture(distances, width, 1, RGBAFormat, FloatType);
  depth.needsUpdate = true;
  const softness = uniform(1.2);
  const filter = createWaterBlur(
    texture(source),
    texture(depth),
    app.camera,
    softness,
  );
  const pipeline = new RenderPipeline(app.renderer, filter.node);
  pipeline.outputColorTransform = false;
  const read = async () => {
    await new Promise(requestAnimationFrame);
    pipeline.render();
    const row = await app.renderer.readRenderTargetPixelsAsync(
      filter.node.renderTarget,
      x - 55,
      y,
      111,
      1,
    );
    return Float32Array.from({ length: 111 }, (_, i) =>
      DataUtils.fromHalfFloat(row[i * 4]),
    );
  };
  try {
    app.manual = true;
    const profiles = [];
    let broad;
    for (const value of [0.4, 1.2, 4]) {
      softness.value = value;
      const row = await read(),
        peak = Math.max(...row);
      if (!row.every(Number.isFinite) || peak <= 0)
        throw new Error("Invalid water blur impulse");
      let rebound = 0;
      for (let i = 0; i < 49; i++)
        rebound = Math.max(
          rebound,
          row[56 + i] - row[55 + i],
          row[54 - i] - row[55 - i],
        );
      const ratio = rebound / peak;
      if (ratio > 0.002)
        throw new Error(`Repeated highlight at softness ${value}: ${ratio}`);
      profiles.push({ softness: value, secondaryPeak: ratio });
      if (value === 1.2) broad = row;
    }
    // The near surface to the left should reject the distant bright point.
    const { near, far } = app.camera;
    for (let i = 0; i < width; i++) {
      const distance = i < x - 4 ? 5 : 10;
      distances[i * 4] = (far * (1 - near / distance)) / (far - near);
    }
    depth.needsUpdate = true;
    softness.value = 1.2;
    const guided = await read();
    let original = 0,
      blocked = 0;
    for (let i = 39; i < 49; i++) {
      original += broad[i];
      blocked += guided[i];
    }
    const leakRatio = blocked / original;
    if (!Number.isFinite(leakRatio) || leakRatio > 0.05)
      throw new Error(
        `Distant highlights leak over nearer geometry: ${leakRatio}`,
      );
    return { passed: true, profiles, foregroundLeakRatio: leakRatio };
  } finally {
    pipeline.dispose();
    filter.dispose();
    source.dispose();
    depth.dispose();
    app.manual = manual;
    await new Promise(requestAnimationFrame);
    app.render();
  }
}
