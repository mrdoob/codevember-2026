import { DataUtils, Vector3 } from "three/webgpu";
import { uniform, vec3 } from "three/tsl";
import { PLINTH_RADIUS, PLINTH_TOP } from "../architecture.js";

// Water exports its wave normals; stone keeps PMREM reflections with SSR on.
export async function checkReflections(app = window.caustic) {
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const settings = { ...app.settings },
    before = app.inspect(),
    manual = app.manual;
  const pedestal = app.room.pedestal;
  const original = pedestal.material;
  const marker = original[0].clone(),
    radiance = uniform(0);
  marker.colorNode = vec3(0);
  marker.emissiveNode = vec3(radiance);
  marker.outputNode = null;
  marker.receivedShadowNode = null;
  const decode = (data) => Float32Array.from(data, DataUtils.fromHalfFloat);
  const settle = async () => {
    app.changed();
    app.post.invalidate();
    for (let i = 0; i < 16; i++) {
      await new Promise(requestAnimationFrame);
      app.render();
    }
  };
  const read = async (target, attachment = 0) =>
    decode(
      await app.renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        target.width,
        target.height,
        attachment,
      ),
    );
  const attachments = () => app.post.scenePass.renderTarget;
  const attachmentIndex = (name) =>
    attachments().textures.findIndex((texture) => texture.name === name);
  try {
    app.manual = true;
    app.pause(true);
    Object.assign(app.settings, {
      ssr: true,
      haze: 0,
      bloom: 0,
      waves: 0,
    });
    await settle();
    const flatNormals = await read(attachments(), attachmentIndex("normal"));
    const flatSurface = await read(attachments(), attachmentIndex("diffuse"));
    app.settings.waves = 1;
    await settle();
    const waveNormals = await read(attachments(), attachmentIndex("normal"));
    const waveSurface = await read(attachments(), attachmentIndex("diffuse"));
    let normalChange = 0,
      waterPixels = 0;
    for (let i = 0; i < flatSurface.length / 4; i += 7) {
      if (
        Math.floor(flatSurface[i * 4 + 3] / 256) !== 1 ||
        Math.floor(waveSurface[i * 4 + 3] / 256) !== 1
      )
        continue;
      normalChange +=
        Math.abs(flatNormals[i * 2] - waveNormals[i * 2]) +
        Math.abs(flatNormals[i * 2 + 1] - waveNormals[i * 2 + 1]);
      waterPixels++;
    }
    assert(
      waterPixels > 100,
      "Run reflection checks from the wide view with water visible.",
    );
    normalChange /= waterPixels;
    assert(
      normalChange > 0.005,
      "SSR is receiving a flat water normal instead of the wave normal.",
    );

    const width = attachments().width,
      height = attachments().height;
    const angle = Math.atan2(app.camera.position.x, app.camera.position.z);
    const pixels = new Set();
    for (let a = -0.5; a <= 0.5; a += 0.04)
      for (let y = PLINTH_TOP - 0.25; y < PLINTH_TOP - 0.03; y += 0.025) {
        const p = new Vector3(
          Math.sin(angle + a) * PLINTH_RADIUS,
          0.4 - y,
          Math.cos(angle + a) * PLINTH_RADIUS,
        ).project(app.camera);
        const x = Math.floor((p.x * 0.5 + 0.5) * width),
          sy = Math.floor((0.5 - p.y * 0.5) * height);
        if (x < 0 || x >= width || sy < 0 || sy >= height) continue;
        const i = sy * width + x;
        if (Math.floor(waveSurface[i * 4 + 3] / 256) === 4) pixels.add(i);
      }
    assert(
      pixels.size > 40,
      "The floor in front of the pedestal must be visible for this check.",
    );
    pedestal.material = [marker, original[1], original[2]];
    const results = {};
    for (const enabled of [false, true]) {
      app.settings.ssr = enabled;
      const values = [];
      for (const value of [0, 2]) {
        radiance.value = value;
        await settle();
        const data = await read(app.post.combined.renderTarget);
        let mean = 0;
        for (const i of pixels) mean += data[i * 4];
        values.push(mean / pixels.size);
      }
      results[enabled ? "ssrOn" : "ssrOff"] = {
        dark: values[0],
        bright: values[1],
        change: values[1] - values[0],
      };
    }
    assert(
      Math.abs(results.ssrOff.change) < 0.01,
      "The control region changed without SSR.",
    );
    assert(
      Math.abs(results.ssrOn.change) < 0.01,
      "SSR is still reflecting the pedestal onto the stone.",
    );
    return { passed: true, normalChange, pixels: pixels.size, ...results };
  } finally {
    pedestal.material = original;
    marker.dispose();
    Object.assign(app.settings, settings);
    app.pause(before.paused);
    app.manual = manual;
    app.post.invalidate();
    app.changed();
  }
}
