import { RenderTarget, HalfFloatType, DataUtils } from "three/webgpu";

export async function checkGrading(app) {
  const saved = { ...app.settings };
  const previousTarget = app.renderer.getRenderTarget();
  const target = new RenderTarget(160, 120, {
    type: HalfFloatType,
    depthBuffer: false,
  });
  const neutral = {
    temperature: 0,
    tint: 0,
    contrast: 1,
    saturation: 1,
    lift: 0,
    shadows: "#ffffff",
  };
  const read = async (changes = {}) => {
    Object.assign(app.settings, neutral, changes);
    await new Promise(requestAnimationFrame);
    app.renderer.setRenderTarget(target);
    app.render();
    const pixels = Float32Array.from(
      await app.renderer.readRenderTargetPixelsAsync(target, 0, 0, 160, 120),
      DataUtils.fromHalfFloat,
    );
    if (!pixels.every(Number.isFinite))
      throw new Error("Color grading produces finite pixels");
    app.renderer.setRenderTarget(previousTarget);
    return pixels;
  };
  const mean = (pixels, channel) => {
    let total = 0;
    for (let i = channel; i < pixels.length; i += 4) total += pixels[i];
    return total / (pixels.length / 4);
  };
  const difference = (a, b) =>
    a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
  try {
    const base = await read();
    const warm = await read({ temperature: 0.8 });
    if (mean(warm, 0) / mean(warm, 2) <= mean(base, 0) / mean(base, 2))
      throw new Error("Temperature must warm the rendered image");
    const tinted = await read({ tint: 0.8 });
    if (mean(tinted, 1) >= mean(base, 1))
      throw new Error("Positive tint must reduce green");
    const monochrome = await read({ saturation: 0 });
    if (Math.abs(mean(monochrome, 0) - mean(monochrome, 2)) > 0.0001)
      throw new Error("Zero saturation must be monochrome");
    const contrast = difference(base, await read({ contrast: 1.25 }));
    const shadowTint = difference(base, await read({ shadows: "#99d8ff" }));
    const lifted = await read({ lift: 0.04 });
    if (
      contrast < 0.005 ||
      shadowTint < 0.002 ||
      mean(lifted, 0) <= mean(base, 0) + 0.025
    )
      throw new Error(
        "Contrast, shadow tint and black level must affect the final image",
      );
    return { contrast, shadowTint };
  } finally {
    Object.assign(app.settings, saved);
    app.renderer.setRenderTarget(previousTarget);
    target.dispose();
    app.render();
  }
}
