import {
  DataUtils,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
  DoubleSide,
} from "three/webgpu";

export async function checkLightShafts(app = window.caustic) {
  const settings = { ...app.settings },
    before = app.inspect(),
    manual = app.manual;
  const sun = app.room.sun,
    originalIntensity = sun.intensity;
  let litPixels = 0;
  const blocker = new Mesh(
    new PlaneGeometry(4, 4),
    new MeshBasicNodeMaterial({ color: 0, side: DoubleSide }),
  );
  const frame = async () => {
    await new Promise(requestAnimationFrame);
    app.render();
    const rt = app.post.shafts.volume.renderTarget;
    const data = await app.renderer.readRenderTargetPixelsAsync(
      rt,
      0,
      0,
      rt.width,
      rt.height,
    );
    let energy = 0;
    litPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      let pixel = 0;
      for (let c = 0; c < 3; c++) {
        const value = DataUtils.fromHalfFloat(data[i + c]);
        if (!Number.isFinite(value) || value < 0)
          throw new Error("Invalid shaft radiance.");
        energy += value;
        pixel += value;
      }
      if (pixel > 0.0001) litPixels++;
    }
    return energy;
  };
  try {
    app.manual = true;
    app.pause(true);
    app.settings.lightShafts = 1;
    app.settings.lightShaftWidth = 1;
    app.settings.haze = 2.15;
    const lit = await frame(),
      paused = await frame();
    const narrowPixels = litPixels;
    if (lit < 1) throw new Error("Light shafts are missing.");
    if (lit !== paused)
      throw new Error("Paused shafts changed without motion.");
    blocker.position.set(0, 4.9, 0);
    blocker.rotation.x = -Math.PI / 2;
    blocker.castShadow = true;
    app.scene.add(blocker);
    sun.shadow.needsUpdate = true;
    const shadowed = await frame();
    if (shadowed > lit * 0.7)
      throw new Error("Shafts ignore the sun shadow map.");
    blocker.castShadow = false;
    blocker.position.copy(app.camera.position);
    blocker.quaternion.copy(app.camera.quaternion);
    blocker.translateZ(-0.2);
    sun.shadow.needsUpdate = true;
    const occluded = await frame();
    if (occluded > 0.00001)
      throw new Error("Shafts draw through foreground geometry.");
    app.scene.remove(blocker);
    sun.intensity = 0;
    const unlit = await frame();
    if (unlit > 0.00001) throw new Error("Shafts emit without sunlight.");
    sun.intensity = originalIntensity;
    app.settings.lightShafts = 0;
    const disabled = await frame();
    if (disabled > 0.00001) throw new Error("Disabled shafts remain visible.");
    app.settings.lightShafts = 1;
    app.settings.haze = 0;
    const clear = await frame();
    if (clear > 0.00001)
      throw new Error("Shafts remain without a scattering medium.");
    app.settings.haze = 2.15;
    app.settings.lightShaftWidth = 4;
    const wide = await frame(),
      widePixels = litPixels;
    if (widePixels < narrowPixels * 1.5)
      throw new Error("Wider shafts did not expand their visible footprint.");
    return {
      passed: true,
      lit,
      paused,
      shadowed,
      occluded,
      unlit,
      disabled,
      clear,
      wide,
      narrowPixels,
      widePixels,
    };
  } finally {
    app.scene.remove(blocker);
    blocker.geometry.dispose();
    blocker.material.dispose();
    sun.intensity = originalIntensity;
    sun.shadow.needsUpdate = true;
    Object.assign(app.settings, settings);
    app.pause(before.paused);
    app.manual = manual;
    app.post.invalidate();
    app.changed();
  }
}
