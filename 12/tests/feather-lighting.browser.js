import { Scene, PerspectiveCamera, PlaneGeometry, InstancedMesh, InstancedBufferAttribute, Float32BufferAttribute, Object3D, DirectionalLight, RenderTarget, HalfFloatType, NoToneMapping, Color, DataUtils } from 'three/webgpu';
import { createFeatherMaterial } from '../feather-material.js';

// Rotate a thin vane in place, keeping the camera and light fixed. Moving
// the camera around a fixed sun alone cannot detect a one-sided material.
export async function checkFeatherLighting(app = window.feather) {
  const renderer = app.renderer, manual = app.manual;
  const target = renderer.getRenderTarget(), toneMapping = renderer.toneMapping;
  const clearColor = renderer.getClearColor(new Color()), clearAlpha = renderer.getClearAlpha();
  const scene = new Scene(), camera = new PerspectiveCamera(40, 1, .1, 20);
  camera.position.z = 4;
  const fibers = createFeatherMaterial();
  fibers.breeze.value = 0;
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute('fiber', new Float32BufferAttribute(Array(4).fill([.9, .08, .5]).flat(), 3));
  geometry.setAttribute('featherPhase', new InstancedBufferAttribute(new Float32Array([0]), 1));
  geometry.setAttribute('featherTint', new InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3));
  const vane = new InstancedMesh(geometry, fibers.material, 1), pose = new Object3D();
  const sun = new DirectionalLight(0xffffff, 3);
  scene.add(vane, sun, sun.target);
  const output = new RenderTarget(64, 64, { type: HalfFloatType });
  const results = [];
  const check = (condition, label, detail) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(detail)}`);
    results.push({ check: label, detail });
  };
  const sample = async (angle, scattering) => {
    pose.rotation.y = angle; pose.updateMatrix();
    vane.setMatrixAt(0, pose.matrix); vane.instanceMatrix.needsUpdate = true;
    fibers.scattering.value = scattering;
    await new Promise(requestAnimationFrame);
    renderer.setRenderTarget(output); renderer.render(scene, camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(output, 28, 28, 8, 8);
    let radiance = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      radiance += DataUtils.fromHalfFloat(pixels[i]) + DataUtils.fromHalfFloat(pixels[i + 1]) + DataUtils.fromHalfFloat(pixels[i + 2]);
    }
    return radiance / (8 * 8 * 3);
  };
  try {
    app.manual = true;
    renderer.toneMapping = NoToneMapping; renderer.setClearColor(0, 0);
    const contributions = {};
    for (const [name, direction] of [
      ['backlit', [0, 0, -5]], ['grazing', [5, 0, 0]], ['frontlit', [0, 0, 5]],
    ]) {
      sun.position.set(...direction);
      const frontOpaque = await sample(0, 0), frontScattered = await sample(0, 1);
      const backOpaque = await sample(Math.PI, 0), backScattered = await sample(Math.PI, 1);
      const front = frontScattered - frontOpaque, back = backScattered - backOpaque;
      check(front > .01 && back > .01, `Both vane faces scatter with ${name} light`, { front, back });
      const difference = Math.abs(front - back) / Math.max(front, back);
      check(difference < .02, `Flipping the vane preserves ${name} scattering`, { difference });
      contributions[name] = front;
    }
    check(contributions.backlit > contributions.frontlit * 3, 'Backlighting remains stronger than the soft frontlit response', contributions);
    sun.intensity = 0;
    const dark = await sample(0, 0), unlit = await sample(0, 1);
    check(Math.abs(unlit - dark) < .0001, 'Scattering requires incident light', { dark, unlit });
    return { passed: results.length, results };
  } finally {
    renderer.setRenderTarget(target); renderer.toneMapping = toneMapping;
    renderer.setClearColor(clearColor, clearAlpha);
    output.dispose(); geometry.dispose(); vane.dispose(); fibers.material.dispose();
    app.manual = manual;
  }
}
