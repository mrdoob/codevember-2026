import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { createWoodland } from './woodland.js';
import { createSoftShadowFilter } from './soft-shadow.js';

export async function createHabitat(scene, renderer, materials, settings) {
  const woodland = createWoodland(materials.stone);
  const sky = new SkyMesh();
  sky.name = 'Blue-hour SkyMesh'; sky.renderOrder = -1;
  sky.scale.setScalar(450000); sky.frustumCulled = false;
  sky.turbidity.value = 2;
  sky.rayleigh.value = 3;
  sky.mieCoefficient.value = .002;
  sky.mieDirectionalG.value = .8;
  sky.cloudCoverage.value = .25;
  sky.cloudDensity.value = .35;
  // Keep the captured lighting and the paused scene in agreement.
  sky.cloudSpeed.value = 0;
  const fog = new THREE.FogExp2('#18283d', .012);
  const ambient = new THREE.HemisphereLight('#afc4e8', '#35443e', 1.05);
  // A soft directional proxy for the brightest opening in the sky dome.
  // The real solar direction belongs to SkyMesh and is below the horizon at dusk.
  const sun = new THREE.DirectionalLight('#a3bee8', 1.15);
  sun.name = 'Soft skylight';
  sun.target.position.set(0, .7, 0);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -3.4; sun.shadow.camera.right = 3.4;
  sun.shadow.camera.top = 3.4; sun.shadow.camera.bottom = -3.4;
  sun.shadow.camera.near = .5; sun.shadow.camera.far = 14;
  sun.shadow.normalBias = .001; sun.shadow.bias = -.000025;
  sun.shadow.radius = 24;
  sun.shadow.filterNode = createSoftShadowFilter(sun.shadow);

  const cool = new THREE.Color('#a3bee8'), warm = new THREE.Color('#fff7e7');
  const duskFill = new THREE.Color('#afc4e8'), dayFill = new THREE.Color('#e2edf1');
  const duskGround = new THREE.Color('#35443e'), dayGround = new THREE.Color('#626747');
  const duskFog = new THREE.Color('#18283d'), dayFog = new THREE.Color('#364b3a');
  function updateLighting() {
    const azimuth = THREE.MathUtils.degToRad(settings.sunAzimuth);
    const elevation = THREE.MathUtils.degToRad(settings.sunHeight);
    const day = THREE.MathUtils.smoothstep(settings.sunHeight, 0, 12);
    sky.sunPosition.value.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
    const keyElevation = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(55, settings.sunHeight, day));
    sun.position.setFromSphericalCoords(8, Math.PI / 2 - keyElevation, azimuth).add(sun.target.position);
    sun.color.copy(cool).lerp(warm, day); sun.intensity = 1.15 + day * 2.05;
    ambient.color.copy(duskFill).lerp(dayFill, day);
    ambient.groundColor.copy(duskGround).lerp(dayGround, day);
    ambient.intensity = 1.05 - day * .3;
    fog.color.copy(duskFog).lerp(dayFog, day); fog.density = .012 - day * .008;
  }
  updateLighting();

  // Woodland geometry and sky supply the reflection and diffuse environment.
  // Keep the floating rocks out of the probe; no images or precomputed maps.
  const capture = new THREE.Scene();
  capture.fog = fog;
  const pmrem = new THREE.PMREMGenerator(renderer);
  let environment;
  function refreshEnvironment() {
    capture.add(woodland.group, sky, ambient, sun, sun.target);
    sky.showSunDisc.value = 0; sun.castShadow = false;
    try {
      const next = pmrem.fromScene(capture, .015, .1, 115, { position: new THREE.Vector3(0, 1.1, 0), size: 256 });
      scene.environment = next.texture;
      environment?.dispose(); environment = next;
    } finally {
      sky.showSunDisc.value = 1; sun.castShadow = true;
      scene.add(woodland.group, sky, ambient, sun, sun.target);
    }
  }
  scene.environmentIntensity = .9;
  scene.background = new THREE.Color('#18283d');
  scene.fog = fog;
  refreshEnvironment();
  return { sun, ambient, sky, woodland, updateLighting, refreshEnvironment,
    dispose() {
      woodland.dispose(); sky.geometry.dispose(); sky.material.dispose(); environment?.dispose(); pmrem.dispose(); sun.dispose(); ambient.dispose();
    }
  };
}
