import * as THREE from "three/webgpu";
import { Fn, shadow as shadowNode, uniform } from "three/tsl";
import { createFloorSurface } from "./floor-surface.js";
import { createStudioEnvironment } from "./studio-environment.js";
import { createPCSSFilter, SHADOW_MAP_SIZE } from "./pcss-shadow.js";

// The bottoms of the speaker's rubber feet, in scene units.
export const FLOOR_HEIGHT = -0.7584;

export function createStudio(scene, renderer) {
  scene.background = new THREE.Color("#080f12");
  scene.fog = new THREE.FogExp2("#080f12", 0.018);
  const environment = createStudioEnvironment(renderer);
  scene.environment = environment.texture;
  scene.environmentIntensity = 1;

  const shadow = new THREE.DirectionalLight("#d3e4e9", 1.15);
  shadow.position.set(-4, 7, 2);
  shadow.castShadow = true;
  Object.assign(shadow.shadow.camera, {
    left: -6,
    right: 6,
    top: 6,
    bottom: -6,
    near: 0.5,
    far: 22,
  });
  shadow.shadow.camera.updateProjectionMatrix();
  shadow.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  shadow.shadow.bias = -0.00005;
  shadow.shadow.normalBias = 0.0018;
  const shadowFilter = createPCSSFilter(uniform(0.09));
  shadow.shadow.filterNode = shadowFilter.filter;
  const visibility = shadowNode(shadow);
  shadow.shadow.shadowNode = visibility;
  // Reuse the shadow light's actual blockers for near-contact occlusion of
  // the environment lighting on the membrane and grains.
  const contactAO = Fn(() => {
    const visible = visibility.toVar();
    return visible.oneMinus().mul(shadowFilter.contact).mul(0.7).oneMinus();
  })();
  scene.add(shadow, shadow.target);

  const floorMaterial = new THREE.MeshPhysicalNodeMaterial({
    color: "#2e393c",
    roughness: 0.85,
    metalness: 0,
    clearcoat: 0,
    ior: 1.46,
    specularIntensity: 0.15,
    // Keep the worn coating diffuse, with restrained light-card highlights.
    envMap: environment.texture,
    envMapIntensity: 0.85,
  });
  const floorSurface = createFloorSurface(floorMaterial);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    floorMaterial,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_HEIGHT;
  floor.receiveShadow = true;
  scene.add(floor);
  return {
    environment,
    shadow,
    floor,
    floorSurface,
    contactAO,
    dispose() {
      floorSurface.dispose();
      environment.dispose();
      shadow.shadow.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
    },
  };
}
