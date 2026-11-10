import { DataUtils, Vector3 } from "three/webgpu";

// Verify real cast shadows on both treads and upright architecture, with
// projected caustics disabled so they cannot masquerade as light/shadow.
export async function checkLighting(app = window.caustic) {
  const settings = { ...app.settings },
    before = app.inspect(),
    manual = app.manual;
  const intensity = app.room.sun.shadow.intensity;
  const read = async (attachment) => {
    const rt = app.post.scenePass.renderTarget;
    return Float32Array.from(
      await app.renderer.readRenderTargetPixelsAsync(
        rt,
        0,
        0,
        rt.width,
        rt.height,
        rt.textures.findIndex((t) => t.name === attachment),
      ),
      DataUtils.fromHalfFloat,
    );
  };
  const settle = async () => {
    app.changed();
    for (let i = 0; i < 3; i++) {
      await new Promise(requestAnimationFrame);
      app.render();
    }
  };
  try {
    app.manual = true;
    app.pause(true);
    app.settings.caustics = 0;
    app.room.sun.shadow.intensity = 0;
    await settle();
    const unshadowed = await read("output");
    app.room.sun.shadow.intensity = 1;
    await settle();
    const shadowed = await read("output");
    const surface = await read("diffuse"),
      normals = await read("normal"),
      n = new Vector3();
    const affected = { treads: 0, upright: 0 };
    let maxReduction = 0;
    for (let i = 0; i < surface.length / 4; i += 3) {
      const kind = Math.floor(surface[i * 4 + 3] / 256);
      if (kind !== 0 && kind !== 4) continue;
      const reduction = unshadowed[i * 4] - shadowed[i * 4];
      if (reduction < 0.03) continue;
      maxReduction = Math.max(maxReduction, reduction);
      n.set(
        normals[i * 2],
        normals[i * 2 + 1],
        1 - Math.abs(normals[i * 2]) - Math.abs(normals[i * 2 + 1]),
      );
      const t = Math.max(0, -n.z);
      n.x += n.x >= 0 ? -t : t;
      n.y += n.y >= 0 ? -t : t;
      n.normalize().transformDirection(app.camera.matrixWorld);
      if (kind === 4 && n.y > 0.8) affected.treads++;
      else if (Math.abs(n.y) < 0.5) affected.upright++;
    }
    if (affected.treads < 100 || affected.upright < 100)
      throw new Error(
        `Missing architectural shadows: ${JSON.stringify(affected)}`,
      );
    return { passed: true, affected, maxReduction };
  } finally {
    app.room.sun.shadow.intensity = intensity;
    Object.assign(app.settings, settings);
    app.pause(before.paused);
    app.manual = manual;
    app.post.invalidate();
    app.changed();
  }
}
