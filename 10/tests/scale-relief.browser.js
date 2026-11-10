import { DataUtils, Vector3 } from "three/webgpu";

// Check the actual normals consumed by lighting and SSR, not the strength knob.
export async function checkScaleRelief(app = window.caustic) {
  const before = app.inspect(),
    manual = app.manual,
    strength = app.settings.fishRelief;
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
  const decode = (data, i, n) => {
    n.set(
      data[i * 2],
      data[i * 2 + 1],
      1 - Math.abs(data[i * 2]) - Math.abs(data[i * 2 + 1]),
    );
    const t = Math.max(0, -n.z);
    n.x += n.x >= 0 ? -t : t;
    n.y += n.y >= 0 ? -t : t;
    return n.normalize();
  };
  try {
    app.manual = true;
    app.pause(true);
    const frames = [];
    for (const relief of [0, 1]) {
      app.settings.fishRelief = relief;
      await new Promise(requestAnimationFrame);
      app.render();
      frames.push(await read("normal"));
    }
    const surface = await read("diffuse"),
      a = new Vector3(),
      b = new Vector3();
    let degrees = 0,
      pixels = 0,
      detailed = 0;
    for (let i = 0; i < surface.length / 4; i++) {
      if (Math.floor(surface[i * 4 + 3] / 256) !== 5) continue;
      const angle =
        (Math.acos(
          Math.max(
            -1,
            Math.min(1, decode(frames[0], i, a).dot(decode(frames[1], i, b))),
          ),
        ) *
          180) /
        Math.PI;
      if (!Number.isFinite(angle))
        throw new Error("Invalid fish scale normal.");
      degrees += angle;
      pixels++;
      if (angle > 3) detailed++;
    }
    if (pixels < 100 || degrees / pixels < 0.5 || detailed < 50)
      throw new Error(
        "The scale texture does not visibly perturb the fish normals.",
      );
    return { passed: true, pixels, detailed, meanDegrees: degrees / pixels };
  } finally {
    app.settings.fishRelief = strength;
    app.pause(before.paused);
    app.manual = manual;
    app.post.invalidate();
    app.changed();
  }
}
