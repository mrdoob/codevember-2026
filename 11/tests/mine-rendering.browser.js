import { DataUtils } from "three/webgpu";
import { checkDust } from "./dust.browser.js";
import { checkFogBackground, checkWaterBlur } from "./fog.browser.js";
import { checkGrading } from "./grading.browser.js";
import { checkWaterFilter } from "./water-filter.browser.js";
export async function checkMineRendering(app = window.rust) {
  const settings = { ...app.settings },
    manual = app.manual,
    paused = app.paused;
  const check = (v, message) => {
    if (!v) throw new Error(message);
  };
  const read = async (post = false) => {
    await new Promise(requestAnimationFrame);
    app.render();
    const rt = (post ? app.post.composite : app.post.scenePass).renderTarget;
    const center = app.journey.current.mineVisual.group.position
      .clone()
      .project(app.camera);
    const size = Math.min(256, rt.width, rt.height),
      x = Math.max(
        0,
        Math.min(
          rt.width - size,
          Math.floor((center.x * 0.5 + 0.5) * rt.width - size / 2),
        ),
      ),
      y = Math.max(
        0,
        Math.min(
          rt.height - size,
          Math.floor((-center.y * 0.5 + 0.5) * rt.height - size / 2),
        ),
      );
    const data = await app.renderer.readRenderTargetPixelsAsync(
      rt,
      x,
      y,
      size,
      size,
    );
    const floats = Float32Array.from(data, DataUtils.fromHalfFloat);
    check(floats.every(Number.isFinite), "Finite GPU pixels");
    return floats;
  };
  const difference = (a, b) =>
    a.reduce((sum, x, i) => sum + (i % 4 === 3 ? 0 : Math.abs(x - b[i])), 0) /
    (a.length * 0.75);
  try {
    app.manual = true;
    // Material comparisons use one fixed view; orbit interaction is checked separately.
    app.settings.orbitSpeed = 0;
    app.reset(2);
    app.setAuto(false);
    app.pause(false);
    const fixedCamera = JSON.stringify(app.journey.cameraPose());
    check(
      app.journey.current.simulation.mine.position[1] < -5,
      "Mine begins below the frame",
    );
    for (
      let i = 0;
      i < 1800 && app.journey.current.simulation.phase !== "ready";
      i++
    )
      app.advance(1 / 120);
    check(
      app.journey.current.simulation.phase === "ready",
      "Rising mine is caught by its tether",
    );
    check(
      JSON.stringify(app.journey.cameraPose()) === fixedCamera,
      "Entrance leaves camera fixed",
    );
    app.pause(true);
    check(app.renderer.backend.isWebGPUBackend, "Native WebGPU");
    app.settings.rust = 0;
    const metal = await read();
    app.settings.rust = 1;
    const rusty = await read();
    const corrosion = difference(metal, rusty);
    check(corrosion > 0.01, "Corrosion changes shell shading");
    app.settings.relief = 0;
    const flat = await read();
    app.settings.relief = 1.3;
    const textured = await read();
    const relief = difference(flat, textured);
    check(relief > 0.0005, "Shell relief affects illumination");
    const shellUV =
      app.journey.current.mineVisual.meshes[0].geometry.attributes.uv;
    const originalUV = shellUV.array.slice();
    let mappingDifference;
    try {
      // Collapsing every spherical UV also collapses both poles. Object-space
      // corrosion must render identically, including its height-derived normal.
      shellUV.array.fill(0);
      shellUV.needsUpdate = true;
      mappingDifference = difference(textured, await read());
      check(
        mappingDifference < 0.000001,
        "Mine corrosion is independent of spherical UVs",
      );
    } finally {
      shellUV.array.set(originalUV);
      shellUV.needsUpdate = true;
    }
    const profiles = app.journey.current.mineVisual.meshes.map(
      (m) => m.geometry.attributes.mineSurface,
    );
    const originalProfiles = profiles.map((p) => p.array.slice());
    const setProfile = (corrosion, relief) => {
      for (const profile of profiles) {
        for (let i = 0; i < profile.count; i++)
          profile.setXY(i, corrosion, relief);
        profile.needsUpdate = true;
      }
    };
    let surfaceVariation;
    try {
      app.settings.rust = 0.66;
      setProfile(-0.14, 1);
      const worn = await read();
      setProfile(0.14, 1);
      const corroded = await read();
      setProfile(0.14, 0.65);
      const shallow = await read();
      setProfile(0.14, 1.5);
      const deep = await read();
      surfaceVariation = {
        corrosion: difference(worn, corroded),
        relief: difference(shallow, deep),
      };
      check(
        surfaceVariation.corrosion > 0.005 && surfaceVariation.relief > 0.0005,
        "Each mine's corrosion and relief profile changes rendered pixels",
      );
    } finally {
      profiles.forEach((profile, i) => {
        profile.array.set(originalProfiles[i]);
        profile.needsUpdate = true;
      });
      app.settings.rust = 1;
    }
    app.settings.relief = settings.relief;
    app.settings.occlusion = 0;
    const unoccluded = await read(true);
    app.settings.occlusion = settings.occlusion;
    const contactShadows = difference(unoccluded, await read(true));
    check(
      contactShadows > 0.002,
      "Default GTAO visibly darkens fittings and contact areas",
    );
    app.settings.fog = 0;
    const clear = await read(true);
    app.settings.fog = settings.fog;
    const waterHaze = difference(clear, await read(true));
    check(waterHaze > 0.005, "Default fog visibly changes underwater shading");
    Object.assign(app.settings, settings, { orbitSpeed: 0 });
    const fogBackground = await checkFogBackground(app);
    const waterBlur = await checkWaterBlur(app);
    const waterFilter = await checkWaterFilter(app);
    const grading = await checkGrading(app);
    const reactiveDust = await checkDust(app);
    const shot = app.journey.current,
      marine = shot.mineVisual.marine;
    const bubbleImage = async () => {
      await new Promise(requestAnimationFrame);
      app.render();
      const target = app.post.composite.renderTarget;
      const pixels = await app.renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        target.width,
        target.height,
      );
      return Float32Array.from(pixels, DataUtils.fromHalfFloat);
    };
    const originalBlur = app.settings.fogBlur;
    let bubbleMinimum = Infinity,
      bubbleHighlight = 0,
      bubbleBlurRatio;
    try {
      app.settings.fogBlur = 0;
      const sharp = await bubbleImage();
      marine.bubbles.visible = false;
      const clearBackground = await bubbleImage();
      marine.bubbles.visible = true;
      app.settings.fogBlur = 1.2;
      const soft = await bubbleImage();
      marine.bubbles.visible = false;
      const softBackground = await bubbleImage();
      let sharpDetail = 0,
        softDetail = 0;
      for (let i = 4; i < sharp.length; i++)
        if (i % 4 !== 3) {
          const a = sharp[i] - clearBackground[i];
          const b = soft[i] - softBackground[i];
          sharpDetail += (a - (sharp[i - 4] - clearBackground[i - 4])) ** 2;
          softDetail += (b - (soft[i - 4] - softBackground[i - 4])) ** 2;
          bubbleMinimum = Math.min(bubbleMinimum, b);
          bubbleHighlight = Math.max(bubbleHighlight, b);
        }
      bubbleBlurRatio = softDetail / sharpDetail;
      check(
        bubbleMinimum >= -0.0001,
        `Blurred bubbles cannot darken the water behind them (${bubbleMinimum}, peak ${bubbleHighlight}, blur ${bubbleBlurRatio})`,
      );
      check(
        bubbleHighlight > 0.005,
        "Bubble rims retain visible highlights in fog",
      );
      check(
        bubbleBlurRatio < 0.85,
        "Water scattering visibly softens bubble rims",
      );
    } finally {
      app.settings.fogBlur = originalBlur;
      marine.bubbles.visible = true;
    }
    const frozen = JSON.stringify(marine.physics.strands.map((s) => s.points));
    const bubbleFrozen = marine.bubbleStates.map((b) => b.age);
    app.advance(1);
    check(
      JSON.stringify(marine.physics.strands.map((s) => s.points)) === frozen &&
        marine.bubbleStates.every((b, i) => b.age === bubbleFrozen[i]),
      "Pause freezes algae and bubbles",
    );
    app.pause(false);
    app.setAuto(false);
    const bubble = marine.bubbleStates.find((b) => b.age > 0.2 && b.age < 2),
      oldBubble = bubble.p.clone();
    const strand = marine.physics.strands.find((s) => s.root[2] > 0.8),
      oldRoot = [...strand.points[0]],
      oldTip = [...strand.points.at(-1)];
    shot.simulation.dragTarget = [0.7, 0.8, 0];
    app.advance(0.4);
    const rootDelta = strand.points[0].map((v, k) => v - oldRoot[k]),
      tipDelta = strand.points.at(-1).map((v, k) => v - oldTip[k]);
    check(
      Math.hypot(...rootDelta.map((v, k) => v - tipDelta[k])) > 0.015,
      "Algae trails the moving shell",
    );
    check(
      bubble.p.y > oldBubble.y && Math.abs(bubble.p.x - oldBubble.x) < 0.15,
      "Released bubbles rise independently",
    );
    shot.simulation.dragTarget = [0, 5, 0];
    for (let i = 0; i < 600 && !shot.simulation.broken; i++)
      app.advance(1 / 120);
    check(shot.simulation.broken, "Dragging up breaks the tether");
    check(
      marine.physics.strands.some((s) =>
        shot.simulation.fragments.includes(s.body),
      ),
      "Algae stays attached to fractured links",
    );
    await read();
    check(
      shot.visual.fragmentMeshes.every((m) => m.visible),
      "Broken link becomes visible fragments",
    );
    const y = shot.simulation.mine.position[1];
    app.advance(1);
    check(shot.simulation.mine.position[1] > y + 0.3, "Released mine rises");
    for (let i = 0; i < 600 && app.journey.index < 1; i++) app.advance(1 / 120);
    check(app.journey.index === 1, "Next mine appears");
    check(
      JSON.stringify(app.journey.current.mineVisual.surfaceVariation) !==
        JSON.stringify(shot.mineVisual.surfaceVariation),
      "Replacement receives a different surface profile",
    );
    check(
      app.journey.current.mineVisual.meshes[0].material ===
        shot.mineVisual.meshes[0].material,
      "Surface variation reuses the compiled material",
    );
    check(
      app.journey.current.simulation.phase === "rising" &&
        app.journey.current.simulation.mine.position[1] < -5,
      "Replacement rises from below",
    );
    check(
      JSON.stringify(app.journey.cameraPose()) === fixedCamera,
      "Camera stays fixed after release",
    );
    await read();
    check(
      app.journey.current.mineVisual.meshes.every((m) => m.visible),
      "Detailed next shell remains visible",
    );
    check(
      app.journey.current.simulation.chainCount === 1,
      "Every mine has a single tether",
    );
    return {
      passed: true,
      backend: app.renderer.backend.constructor.name,
      corrosion,
      relief,
      mappingDifference,
      surfaceVariation,
      contactShadows,
      waterHaze,
      fogBackground,
      waterBlur,
      waterFilter,
      grading,
      reactiveDust,
      bubbles: marine.bubbleStates.length,
      bubbleMinimum,
      bubbleHighlight,
      bubbleBlurRatio,
      algaeStrands: marine.physics.strands.length,
    };
  } finally {
    Object.assign(app.settings, settings);
    app.reset(2);
    app.setAuto(settings.auto);
    app.pause(paused);
    app.manual = manual;
    await new Promise(requestAnimationFrame);
    app.render();
  }
}
