import { WATER_HEIGHT } from "../motion.js";
import { DataUtils } from "three/webgpu";

export async function checkScene(app = window.caustic) {
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const before = app.inspect(),
    manual = app.manual;
  const settings = { ...app.settings };
  app.manual = true;
  const nextFrame = () => new Promise(requestAnimationFrame);
  try {
    app.pause(false);
    app.settings.float = true;
    app.settings.fish = app.settings.algae = true;
    const mirrors = app.water.reflection.captures,
      probes = app.crystal.captures;
    const fishBefore = app.marine.fish.instanceMatrix.array.slice();
    for (let i = 0; i < 3; i++) {
      await nextFrame();
      app.advance(1 / 30);
      app.render();
      assert(
        app.crystal.probeCamera.position.equals(app.crystal.mesh.position),
        "The refraction capture trails the crystal.",
      );
      assert(
        Math.abs(
          app.water.reflection.camera.position.y +
            app.camera.position.y -
            WATER_HEIGHT * 2,
        ) < 1e-6,
        "The reflected camera is not mirrored across the water.",
      );
    }
    assert(
      app.crystal.captures - probes === 3,
      "Refraction did not update on every frame.",
    );
    assert(
      app.water.reflection.captures - mirrors === 3,
      "The water reflection did not update on every frame.",
    );
    assert(
      fishBefore.some((v, i) => v !== app.marine.fish.instanceMatrix.array[i]),
      "The schools did not swim.",
    );
    const target = app.post.scenePass.renderTarget;
    const hdr = await app.renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      target.width,
      target.height,
    );
    for (let i = 0; i < hdr.length; i++) {
      if (i % 4 === 3) continue;
      const v = DataUtils.fromHalfFloat(hdr[i]);
      assert(
        Number.isFinite(v) && v >= -0.001 && v < 8192,
        "Invalid or amplified optical radiance in the scene.",
      );
    }
    app.pause(true);
    const time = app.inspect().time,
      fish = app.marine.fish.instanceMatrix.array.slice();
    await nextFrame();
    app.advance(1);
    app.render();
    assert(app.inspect().time === time, "Pause advanced the water clock.");
    assert(
      fish.every((v, i) => v === app.marine.fish.instanceMatrix.array[i]),
      "Paused fish moved.",
    );
    for (const kind of ["fish", "algae"]) {
      app.settings[kind] = false;
      await nextFrame();
      app.render();
      assert(
        !app.marine[kind].visible,
        `The ${kind} switch did not hide its meshes.`,
      );
      if (kind === "algae")
        assert(!app.marine.smallAlgae.visible, "Small algae remained visible.");
    }
    await app.renderer.backend.device.queue.onSubmittedWorkDone();
    return { passed: true, checks: 10 };
  } finally {
    Object.assign(app.settings, settings);
    app.pause(before.paused);
    app.manual = manual;
    app.changed();
  }
}
