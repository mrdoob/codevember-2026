import * as THREE from "three/webgpu";
import { color } from "three/tsl";
import { createDepthOfField } from "../depth-of-field.js";
import { createMaterials } from "../materials.js";

// Run in the served page: await (await import('./tests/rendering.browser.js')).runRenderingChecks()
// A separate, unattached canvas keeps these GPU regressions out of the preview.
export async function runRenderingChecks() {
  const renderer = new THREE.WebGPURenderer({
    canvas: document.createElement("canvas"),
    antialias: false,
  });
  await renderer.init();
  renderer.setSize(256, 128, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(40, 2, 0.1, 50);
  camera.position.z = 10;
  const target = new THREE.RenderTarget(256, 128);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const red = new THREE.MeshBasicNodeMaterial({ color: 0xff0000 });
  const blue = new THREE.MeshBasicNodeMaterial({ color: 0x0000ff });
  const front = new THREE.Mesh(geometry, red),
    back = new THREE.Mesh(geometry, blue);
  front.scale.set(8, 8, 1);
  front.position.set(-4, 0, 2); // Right edge at the middle of the image.
  back.scale.set(80, 80, 1);
  back.position.z = -5;
  scene.add(front, back);
  const dof = createDepthOfField(renderer, scene, camera);
  const settings = {
    depthOfField: true,
    lensBlur: 1,
    warmth: 0,
    tint: 0,
    contrast: 1,
    saturation: 1,
  };
  const materials = createMaterials(color("#748397"));
  const metal = materials.metal();
  const read = async (effect = true) => {
    await new Promise(requestAnimationFrame);
    renderer.setRenderTarget(target);
    if (effect) dof.render(settings, 8);
    else renderer.render(scene, camera);
    return renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
  };
  const channelMax = (pixels, from, to, channel) => {
    let max = 0;
    for (let x = from; x <= to; x++)
      max = Math.max(max, pixels[(64 * 256 + x) * 4 + channel]);
    return max;
  };
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  try {
    // Sharp red foreground must not be pulled into the blurred blue background.
    let pixels = await read();
    const farLeak = channelMax(pixels, 130, 150, 0);
    check(
      farLeak <= 2,
      `Sharp foreground leaked into far blur: ${farLeak}/255 red`,
    );
    check(pixels[(64 * 256 + 135) * 4 + 2] > 250, "Far layer was not rendered");

    // A blurred red foreground must not borrow blue from a sharp background.
    front.position.z = 5;
    back.position.z = 2;
    pixels = await read();
    const nearLeak = channelMax(pixels, 112, 125, 2);
    check(
      nearLeak <= 2,
      `Sharp background leaked into near blur: ${nearLeak}/255 blue`,
    );
    check(pixels[(64 * 256 + 120) * 4] > 250, "Near layer was not rendered");
    check(
      pixels[(64 * 256 + 130) * 4] > 5,
      "Near test surface is inside the sharp band, so blur was not exercised",
    );

    settings.depthOfField = false;
    pixels = await read();
    check(
      channelMax(pixels, 130, 150, 0) <= 2,
      "Disabling DOF left foreground blur behind",
    );

    // The exact background endpoint and probe alpha must be reached before removal.
    scene.remove(back);
    front.position.set(0, 0, 2);
    front.material = metal;
    front.userData.fade = 1;
    pixels = await read(false);
    const offset = (64 * 256 + 128) * 4;
    const expected = new THREE.Color("#748397")
      .toArray()
      .map((v) => Math.round(v * 255));
    const tint = Array.from(pixels.slice(offset, offset + 4));
    check(
      expected.every((v, i) => Math.abs(tint[i] - v) <= 1) && tint[3] === 255,
      `Fade did not reach background: ${tint}`,
    );
    materials.probeCapture.value = 1;
    pixels = await read(false);
    const probe = Array.from(pixels.slice(offset, offset + 4));
    check(
      probe.every((v) => v === 0),
      `A fully faded shell still contributes to reflections: ${probe}`,
    );
    return { farLeak, nearLeak, backgroundTint: tint, fadedProbe: probe };
  } finally {
    renderer.setRenderTarget(null);
    dof.dispose();
    materials.dispose();
    metal.dispose();
    target.dispose();
    geometry.dispose();
    red.dispose();
    blue.dispose();
    await renderer.dispose();
  }
}
