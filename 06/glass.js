import * as THREE from "three/webgpu";
import {
  uniform,
  vec3,
  normalize,
  refract,
  dot,
  mix,
  positionView,
  normalView,
  positionLocal,
  mx_fractal_noise_float,
} from "three/tsl";

// Keep Shatter's volume absorption, optical controls and thickness-dependent
// tint, using the renderer's filtered transmission buffer for stable sampling.
export function createGlassSystem() {
  const ior = uniform(1.8),
    dispersion = uniform(0.018),
    roughness = uniform(0.075),
    attenuationDistance = uniform(1 / 1.1);
  const glow = uniform(0);
  const spheres = new Set();
  const localGlow = uniform(0).onObjectUpdate(({ object }) =>
    object.userData.planet === 0 ? 0.22 : 0,
  );
  const dragGlow = uniform(0).onObjectUpdate(
    ({ object }) => (object.userData.dragHighlight || 0) * 0.8,
  );
  const neutral = new THREE.Color(1, 1, 1);
  const pigment = uniform(neutral).onObjectUpdate(
    ({ object }) => object.userData.glassTint || neutral,
  );
  const radius = uniform(1).onObjectUpdate(
    ({ object }) => object.userData.glassRadius || 1,
  );
  const material = new THREE.MeshPhysicalNodeMaterial({
    transmission: 1,
    metalness: 0,
    roughness: 0.035,
    clearcoat: 0.35,
    clearcoatRoughness: 0.08,
  });
  material.emissiveNode = pigment
    .mul(glow.add(localGlow))
    .add(mix(pigment, vec3(1), 0.18).mul(dragGlow));
  material.iorNode = ior;
  const cloud = mx_fractal_noise_float(positionLocal.mul(14), 3, 2, 0.5);
  material.roughnessNode = roughness.add(cloud.mul(0.025));
  material.attenuationColorNode = pigment;
  material.attenuationDistanceNode = attenuationDistance;
  // The renderer's dispersion convention includes a 0.025 scale.
  material.dispersionNode = dispersion.mul(40);
  // The refracted chord of a sphere, rather than a constant slab thickness.
  // All attached spheres have their radius baked into geometry, at unit scale.
  const inside = refract(
    normalize(positionView),
    normalView.normalize(),
    ior.reciprocal(),
  );
  material.thicknessNode = dot(inside, normalView.normalize())
    .mul(radius)
    .mul(-2)
    .max(0);
  let enabled;
  function setEnabled(value) {
    if (enabled === value) return;
    enabled = value;
    material.transmission = value ? 1 : 0;
    // PhysicalLightingModel multiplies transmission by both base colour and
    // volume attenuation. Colour the glass only through Beer–Lambert absorption
    // so a bright HDR source isn't unnecessarily filtered a second time.
    material.colorNode = value
      ? vec3(1)
      : pigment.mul(cloud.mul(0.14).add(1));
    material.needsUpdate = true;
  }
  setEnabled(true);
  return {
    material,
    ior,
    dispersion,
    roughness,
    attach(mesh, tint, sphereRadius) {
      mesh.material = material;
      mesh.userData.glassTint = new THREE.Color(tint);
      mesh.userData.glassRadius = sphereRadius;
      mesh.userData.isGlass = true;
      mesh.userData.dragHighlight = 0;
      spheres.add(mesh);
      mesh.layers.set(1);
      mesh.castShadow = false;
    },
    advance(dt) {
      let changed = false;
      for (const mesh of spheres) {
        const data = mesh.userData;
        const target = data.isDragged ? 1 : data.isHovered ? 0.5 : 0;
        const previous = data.dragHighlight;
        if (previous === target) continue;
        const value = THREE.MathUtils.damp(
          previous,
          target,
          target > previous ? 9 : 6,
          dt,
        );
        data.dragHighlight =
          Math.abs(value - target) < 0.0001 ? target : value;
        changed ||= data.dragHighlight !== previous;
      }
      return changed;
    },
    sync(settings) {
      const transmission = settings.transmission;
      setEnabled(transmission > 0);
      material.transmission = transmission;
      glow.value = settings.planetGlow;
      ior.value = settings.ior;
      attenuationDistance.value =
        settings.absorption > 0 ? 1 / settings.absorption : 0;
      dispersion.value = settings.dispersion;
      roughness.value = settings.glassRoughness;
    },
    dispose() {
      spheres.clear();
      material.dispose();
    },
  };
}
