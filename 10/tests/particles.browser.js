import {
  DataUtils,
  Mesh,
  PlaneGeometry,
  MeshBasicNodeMaterial,
} from "three/webgpu";

export async function checkParticles(app = window.caustic) {
  const settings = { ...app.settings },
    before = app.inspect(),
    manual = app.manual;
  const sun = app.room.sun.intensity,
    ambient = app.settings.environmentIntensity;
  const blocker = new Mesh(
    new PlaneGeometry(4, 4),
    new MeshBasicNodeMaterial({ color: 0 }),
  );
  const frame = async () => {
    await new Promise(requestAnimationFrame);
    app.render();
    const rt = app.post.particlePass.renderTarget;
    const data = await app.renderer.readRenderTargetPixelsAsync(
      rt,
      0,
      0,
      rt.width,
      rt.height,
    );
    let energy = 0,
      visible = 0;
    for (let i = 0; i < data.length; i += 4) {
      let light = 0;
      for (let c = 0; c < 3; c++) {
        const value = DataUtils.fromHalfFloat(data[i + c]);
        if (!Number.isFinite(value) || value < 0)
          throw new Error("Invalid particle radiance.");
        light += value;
      }
      energy += light;
      if (light > 0.001) visible++;
    }
    return { energy, visible };
  };
  try {
    app.manual = true;
    app.pause(true);
    Object.assign(app.settings, {
      particles: true,
      haze: 0,
      fishGlow: 0,
      ssr: false,
    });
    const lit = await frame(),
      paused = await frame();
    if (lit.visible < 100) throw new Error("Lit particles are missing.");
    if (lit.energy !== paused.energy)
      throw new Error("Paused particles changed.");
    app.settings.particleOpacity = 0;
    const transparent = await frame();
    if (transparent.energy > 0.00001)
      throw new Error("Zero-opacity particles remain visible.");
    app.settings.particleOpacity = settings.particleOpacity * 0.5;
    const halfOpacity = await frame();
    if (Math.abs(halfOpacity.energy / lit.energy - 0.5) > 0.01)
      throw new Error("Particle opacity does not scale the contribution.");
    app.settings.particleOpacity = settings.particleOpacity;
    app.room.sun.intensity = 0;
    const dim = await frame();
    if (dim.energy > lit.energy * 0.1)
      throw new Error("Unlit particles remain too visible.");
    app.settings.environmentIntensity = 0;
    const dark = await frame();
    if (dark.energy > 0.00001)
      throw new Error("Particles emit light with all sources disabled.");
    app.settings.fishGlow = 0.6;
    const fish = await frame();
    if (fish.visible < 20)
      throw new Error("Particles do not pick up nearby fish emission.");
    app.room.sun.intensity = sun;
    app.settings.environmentIntensity = ambient;
    blocker.position.copy(app.camera.position);
    blocker.quaternion.copy(app.camera.quaternion);
    blocker.translateZ(-0.2);
    app.scene.add(blocker);
    const occluded = await frame();
    if (occluded.energy > 0.00001)
      throw new Error("Particles draw through opaque geometry.");
    app.scene.remove(blocker);
    app.settings.particles = false;
    const hidden = await frame();
    if (hidden.energy > 0.00001)
      throw new Error("Disabled particles remain visible.");
    return {
      passed: true,
      lit,
      transparent,
      halfOpacity,
      dim,
      dark,
      fish,
      occluded,
      hidden,
    };
  } finally {
    app.scene.remove(blocker);
    blocker.geometry.dispose();
    blocker.material.dispose();
    app.room.sun.intensity = sun;
    app.settings.environmentIntensity = ambient;
    Object.assign(app.settings, settings);
    app.pause(before.paused);
    app.manual = manual;
    app.post.invalidate();
    app.changed();
  }
}
