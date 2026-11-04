import * as THREE from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { Fn, shadow, uniform } from 'three/tsl';
import { WAX_LIGHTS } from './lighting-config.js';
import { createPCSSFilter, SHADOW_MAP_SIZE } from './pcss-shadow.js';

// Softboxes retain broad highlights; one bounded shadow map supplies direct
// occlusion on the floor and the wax itself.
export function createStudioLighting(scene, softness = .12, ambientStrength = .55) {
  THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  const softbox = new THREE.RectAreaLight('#fff2e6', 2.6, 5, 6);
  softbox.position.set(-3.5, 5, 5); softbox.lookAt(0, 2, 0);
  const rim = new THREE.RectAreaLight('#edf4ff', 1.5, 3, 5);
  rim.position.set(4, 4, 1); rim.lookAt(0, 2, 0);
  const lights = WAX_LIGHTS.map((config, index) => {
    const light = new THREE.DirectionalLight(config.color, config.intensity);
    light.position.fromArray(config.position); light.target.position.fromArray(config.target);
    light.userData.waxThicknessIndex = index;
    scene.add(light, light.target);
    return light;
  });
  const [key, back] = lights;
  const shadowSoftness = uniform(softness);
  const shadowAOStrength = uniform(ambientStrength);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  Object.assign(key.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: .5, far: 20 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -.0001; key.shadow.normalBias = .008;
  const pcss = createPCSSFilter(shadowSoftness);
  key.shadow.filterNode = pcss.filter;
  // Share one shadow node between the lit wax and the unlit gradient floor.
  const keyShadow = shadow(key);
  key.shadow.shadowNode = keyShadow;
  const shadowAO = Fn(() => {
    // Evaluate first: the filter writes contact as part of the same search.
    const visibility = keyShadow.toVar();
    return visibility.oneMinus().mul(pcss.contact).mul(shadowAOStrength).oneMinus();
  })();
  scene.add(softbox, rim, new THREE.HemisphereLight('#fff6f4', '#786b86', .65));
  return { key, back, keyShadow, shadowSoftness, shadowAO, shadowAOStrength };
}
