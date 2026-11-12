import {
  BoxGeometry,
  DataUtils,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
} from "three/webgpu";
import { uv, vec2, mix, color } from "three/tsl";

export async function checkWaterBlur(app) {
  const original = { fog: app.settings.fog, fogBlur: app.settings.fogBlur };
  const material = new MeshBasicNodeMaterial();
  const checker = uv().mul(24).floor().dot(vec2(1)).mod(2);
  material.colorNode = mix(color("#03171b"), color("#d4f5f2"), checker);
  const probe = new Mesh(new PlaneGeometry(1.5, 1.5), material);
  probe.position.set(-2.3, 0.2, -1);
  app.scene.add(probe);
  const read = async (edge = false) => {
    await new Promise(requestAnimationFrame);
    app.render();
    const target = app.post.composite.renderTarget;
    const p = probe.position.clone();
    if (edge) p.x -= 0.75;
    p.project(app.camera);
    const size = 96;
    const pixels = await app.renderer.readRenderTargetPixelsAsync(
      target,
      Math.floor((p.x * 0.5 + 0.5) * target.width - size / 2),
      Math.floor((0.5 - p.y * 0.5) * target.height - size / 2),
      size,
      size,
    );
    const result = Float32Array.from(pixels, DataUtils.fromHalfFloat);
    if (!result.every(Number.isFinite))
      throw new Error("Fog scattering produces finite pixels");
    return result;
  };
  const difference = (a, b) =>
    a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
  const detail = (pixels) => {
    let sum = 0;
    for (let y = 1; y < 95; y++)
      for (let x = 1; x < 95; x++) {
        const i = (y * 96 + x) * 4;
        sum +=
          Math.abs(pixels[i] - pixels[i - 4]) +
          Math.abs(pixels[i] - pixels[i - 384]);
      }
    return sum / (94 * 94 * 2);
  };
  try {
    app.settings.fog = 0;
    app.settings.fogBlur = 0;
    const clear = await read();
    app.settings.fogBlur = 2;
    const clearDifference = difference(clear, await read());
    if (clearDifference > 0.00002)
      throw new Error(`Clear water must remain sharp (${clearDifference})`);
    app.settings.fog = 0.22;
    app.settings.fogBlur = 0;
    const sharp = await read();
    app.settings.fogBlur = 1.2;
    const softened = await read();
    const sharpDetail = detail(sharp),
      softenedDetail = detail(softened);
    if (softenedDetail >= sharpDetail * 0.8)
      throw new Error(
        `Fog must soften distant detail (${softenedDetail} / ${sharpDetail})`,
      );
    const softEdge = await read(true);
    probe.visible = false;
    const background = await read(true);
    let edgeSpread = 0;
    for (let y = 8; y < 88; y++)
      for (let x = 40; x < 45; x++) {
        const i = (y * 96 + x) * 4;
        edgeSpread += Math.abs(softEdge[i] - background[i]);
      }
    edgeSpread /= 80 * 5;
    if (edgeSpread < 0.00001)
      throw new Error(
        "Scattered silhouettes must feather beyond the depth edge into the background",
      );
    return { clearDifference, sharpDetail, softenedDetail, edgeSpread };
  } finally {
    Object.assign(app.settings, original);
    app.scene.remove(probe);
    probe.geometry.dispose();
    material.dispose();
  }
}

// A brightly colored object must be visible in clear water, then become
// indistinguishable from the same background pixels in dense fog, even with AO.
export async function checkFogBackground(app) {
  const originalFog = app.settings.fog;
  const probe = new Mesh(
    new BoxGeometry(1.1, 1.1, 1.1),
    new MeshBasicNodeMaterial({ color: "#ff6848" }),
  );
  probe.position.set(-3, -6.2, -9);
  app.scene.add(probe);
  const read = async (visible) => {
    probe.visible = visible;
    await new Promise(requestAnimationFrame);
    app.render();
    const target = app.post.composite.renderTarget;
    const point = probe.position.clone().project(app.camera);
    if (Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1)
      throw new Error("Fog probe must lie inside the camera view");
    const size = 128;
    const pixels = await app.renderer.readRenderTargetPixelsAsync(
      target,
      Math.max(
        0,
        Math.min(
          target.width - size,
          Math.floor((point.x * 0.5 + 0.5) * target.width) - size / 2,
        ),
      ),
      Math.max(
        0,
        Math.min(
          target.height - size,
          Math.floor((0.5 - point.y * 0.5) * target.height) - size / 2,
        ),
      ),
      size,
      size,
    );
    return Float32Array.from(pixels, DataUtils.fromHalfFloat);
  };
  const difference = (a, b) =>
    a.reduce((sum, v, i) => sum + (i % 4 === 3 ? 0 : Math.abs(v - b[i])), 0) /
    (a.length * 0.75);
  try {
    app.settings.fog = 0;
    const clearContrast = difference(await read(true), await read(false));
    if (clearContrast < 0.01)
      throw new Error("Clear-water probe was not visible");
    app.settings.fog = 0.29;
    const foggedContrast = difference(await read(true), await read(false));
    if (foggedContrast > 0.0002)
      throw new Error(
        `Dense fog leaves a silhouette against the background (${foggedContrast})`,
      );
    return { clearContrast, foggedContrast };
  } finally {
    app.settings.fog = originalFog;
    app.scene.remove(probe);
    probe.geometry.dispose();
    probe.material.dispose();
  }
}
