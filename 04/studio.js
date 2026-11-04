import * as THREE from 'three/webgpu';
import { color, positionWorld, mix, uniform, shadow, Fn } from 'three/tsl';
import { createPCSSFilter, SHADOW_MAP_SIZE } from './pcss-shadow.js';

export function createStudio(scene, softShadows = true) {
  scene.background = new THREE.Color('#e7dfd2');
  scene.fog = new THREE.Fog('#e7dfd2', 19, 40);
  const key = new THREE.DirectionalLight('#fff3df', 3.1);
  key.position.set(-3, 8, 4);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.1, far: 22 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.00008;
  key.shadow.normalBias = 0.007;
  const softness = uniform(0.055),
    filter = softShadows ? createPCSSFilter(softness) : null;
  // WebGL comparison samplers cannot also be read as raw depth. Retain the
  // backend's native PCF filter there; WebGPU uses the contact-aware PCSS filter.
  if (filter) key.shadow.filterNode = filter.filter;
  key.shadow.radius = 3.3;
  const visibility = shadow(key);
  key.shadow.shadowNode = visibility;
  const ao = Fn(() => {
    const s = visibility.toVar();
    return s
      .oneMinus()
      .mul(filter?.contact ?? 0.35)
      .mul(0.68)
      .oneMinus();
  })();
  const fill = new THREE.DirectionalLight('#d9e5f3', 0.8);
  fill.position.set(5, 4, -2);
  const rim = new THREE.DirectionalLight('#fff3de', 1.25);
  rim.position.set(-2, 3, -5);
  scene.add(key, key.target, fill, rim, new THREE.HemisphereLight('#fff6e6', '#9d8f7a', 1.15));
  const floorMaterial = new THREE.MeshBasicNodeMaterial();
  const weave = positionWorld.x.mul(590).sin().mul(positionWorld.z.mul(590).sin()).mul(0.006).add(1);
  const gradient = positionWorld.z.mul(0.035).add(0.5).clamp();
  floorMaterial.colorNode = mix(color('#d0c4b2'), color('#e8e0d3'), gradient)
    .mul(weave)
    .mul(visibility.mul(0.25).add(ao.mul(0.75)));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.006;
  floor.receiveShadow = true;
  scene.add(floor);
  return { key, softness, floor, ao };
}
