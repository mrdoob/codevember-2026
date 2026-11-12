import * as THREE from "three/webgpu";
import {
  color,
  mix,
  screenUV,
  uv,
  vec2,
  uniform,
  positionWorld,
  positionView,
} from "three/tsl";

export function createAtmosphere(renderer, scene) {
  const aspect = uniform(1);
  // A broad pool of filtered daylight. Keep the water quiet; the suspended
  // motes carry its motion, and distant objects dissolve into this same color.
  const p = screenUV.sub(vec2(0.62, 0.3)).mul(vec2(aspect, 0.8));
  const halo = p.length().mul(1.45).pow2().negate().exp();
  const haze = uniform(0.3);
  const fogStart = uniform(2.4);
  const waterBackground = mix(
    color("#010506"),
    color("#20494d"),
    halo.mul(0.78),
  );
  scene.backgroundNode = waterBackground;
  // The fog must converge to the exact radiance of the background at this pixel.
  const waterDepth = positionView.z.negate().max(0);
  const sediment = positionWorld.y.negate().sub(1.3).max(0).mul(0.35);
  // Store geometric distance only in the scene pass. Applying the live density
  // in the composite keeps newly created materials in sync with the fog control.
  const fogDistance = waterDepth.add(sediment).div(64).clamp(0, 1);
  const fogAmount = (distance) =>
    distance
      .mul(64)
      .sub(fogStart)
      .max(0)
      .mul(haze)
      .pow2()
      .negate()
      .exp()
      .oneMinus()
      .clamp(0, 1);
  const tent = new THREE.Scene();
  const dark = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
  });
  dark.colorNode = mix(
    color("#010305"),
    color("#071418"),
    positionWorld.normalize().y.smoothstep(-0.3, 1),
  );
  tent.add(new THREE.Mesh(new THREE.SphereGeometry(30, 24, 16), dark));
  // A small submerged light chamber: a broad warm opening, a cool vertical
  // opening, overhead water light and a large lower bounce. Dark walls between
  // them preserve shape and contrast in the reflections. Radiance lives in
  // these emitters; the finished PMREM is used at its normal intensity of 1.
  const cards = [
    { p: [-3.5, 2.7, 3.5], s: [5.5, 5], c: "#ffe4c6", power: 18 },
    { p: [4, 3, -2], s: [2, 7], c: "#9ddce4", power: 22 },
    { p: [0, 6, 1], s: [8, 5], c: "#95bbc2", power: 1.8 },
    { p: [-3, -2, -4], s: [2.5, 4], c: "#c28869", power: 1.25 },
    { p: [3, -0.5, 5], s: [4, 5], c: "#88aeb4", power: 0.35 },
    { p: [-0.5, -4, 1], s: [6, 3.5], c: "#f8bda3", power: 24 },
  ];
  for (const card of cards) {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const edge = uv().sub(0.5).abs().mul(2);
    const opening = edge
      .pow(6)
      .dot(vec2(1))
      .pow(1 / 6)
      .smoothstep(0.65, 1)
      .oneMinus();
    m.colorNode = color(card.c).mul(card.power).mul(opening);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...card.s), m);
    mesh.position.fromArray(card.p);
    mesh.lookAt(0, 0, 0);
    tent.add(mesh);
  }
  const generator = new THREE.PMREMGenerator(renderer),
    environment = generator.fromScene(tent, 0.025, 0.1, 80, { size: 256 });
  generator.dispose();
  tent.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  scene.environment = environment.texture;
  const key = new THREE.DirectionalLight("#ffe6c7", 0.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {
    left: -4.5,
    right: 4.5,
    top: 4.5,
    bottom: -4.5,
    near: 0.1,
    far: 20,
  });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.0015;
  key.shadow.radius = 2;
  const flash = new THREE.PointLight("#ffbb7e", 0, 5, 2);
  flash.name = "Tension and fracture light";
  scene.add(key, key.target, flash);
  const lightCenter = new THREE.Vector3(),
    target = new THREE.Vector3(),
    lightOffset = new THREE.Vector3();
  let previousTime = null;
  let stressGlow = 0;
  return {
    aspect,
    haze,
    fogStart,
    waterBackground,
    fogDistance,
    fogAmount,
    key,
    flash,
    fractureLightStrength: 1,
    environment,
    update(
      time,
      z,
      burstAge = -1,
      [x, y] = [0, 0],
      fracture = null,
      tension = 0,
      cameraPosition = null,
    ) {
      target.set(x, y, z);
      const dt = time - (previousTime ?? time);
      const reset = previousTime === null || dt < 0 || dt > 0.25;
      if (reset) lightCenter.copy(target);
      else lightCenter.lerp(target, 1 - Math.exp(-dt * 10));
      previousTime = time;
      const load =
        fracture && burstAge < 0
          ? THREE.MathUtils.smoothstep(tension, 0.35, 1)
          : 0;
      if (reset) stressGlow = load;
      else
        stressGlow +=
          (load - stressGlow) *
          (1 - Math.exp(-dt * (load > stressGlow ? 12 : 7)));
      // Follow the actual focal depth, easing the handoff to the next assembly.
      key.position.set(
        lightCenter.x - 3.5,
        lightCenter.y + 2.2,
        lightCenter.z + 0.8,
      );
      key.target.position.copy(lightCenter);
      if (fracture) {
        flash.position.fromArray(fracture);
        // Lift the source just off the iron toward the orbiting camera, so
        // the lit stock stays readable from either side of the tether.
        if (cameraPosition) {
          lightOffset.copy(cameraPosition).sub(flash.position).normalize();
          flash.position.addScaledVector(lightOffset, 0.35);
        }
      }
      flash.intensity = fracture
        ? (burstAge >= 0
            ? 10 * Math.exp(-burstAge * 8)
            : 4.5 * stressGlow ** 2) * this.fractureLightStrength
        : 0;
    },
    dispose() {
      environment.dispose();
      key.shadow.dispose();
    },
  };
}
