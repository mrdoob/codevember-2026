import * as THREE from "three/webgpu";
import {
  color,
  mix,
  positionWorld,
  screenUV,
  uniform,
  uv,
  vec2,
} from "three/tsl";
import { RectAreaLightTexturesLib } from "three/addons/lights/RectAreaLightTexturesLib.js";

export function createStudio(scene, renderer) {
  const aspect = uniform(1);
  const distance = screenUV.sub(vec2(0.5, 0.48)).mul(vec2(aspect, 1)).length();
  scene.backgroundNode = mix(
    color("#dce2eb"),
    color("#748397"),
    distance.smoothstep(0.08, 0.9),
  );

  // A photographic light tent, baked once. Dark cards are as important as the
  // softboxes: they give the silver a readable silhouette against a pale room.
  const room = new THREE.Scene();
  const surround = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  surround.colorNode = mix(
    color("#03060c"),
    color("#66768d"),
    positionWorld.normalize().y.mul(0.5).add(0.5),
  ).mul(0.32);
  room.add(new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), surround));
  const cards = [
    { position: [-7, 5, 6], size: [3.8, 8], color: "#fffaf1", power: 6.5 },
    { position: [7, 1, 3], size: [1.5, 9], color: "#ddeaff", power: 4 },
    { position: [0, 8, -3], size: [8, 3], color: "#ffffff", power: 4 },
    { position: [-2, -6, 4], size: [8, 2], color: "#c9d6eb", power: 0.5 },
    { position: [1, 0.5, 10], size: [4.5, 9], color: "#03060c", power: 1 },
    { position: [0, 1, -9], size: [6, 8], color: "#60708b", power: 0.35 },
    { position: [-6, -1, -4], size: [1, 8], color: "#c2d8ff", power: 2.5 },
  ];
  for (const card of cards) {
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
    });
    const edge = uv().sub(0.5).abs().mul(2);
    const feather = edge.x
      .smoothstep(0.87, 1)
      .oneMinus()
      .mul(edge.y.smoothstep(0.9, 1).oneMinus());
    material.colorNode = color(card.color).mul(card.power).mul(feather);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(...card.size),
      material,
    );
    mesh.position.fromArray(card.position);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.025, 0.1, 100);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
  room.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });

  THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  const key = new THREE.RectAreaLight("#fffaf3", 4.5, 4, 6);
  key.position.set(-4, 5, 5);
  key.lookAt(0, 0, 0);
  const rim = new THREE.RectAreaLight("#c8dcff", 1.8, 2, 7);
  rim.position.set(4, 1, 2);
  rim.lookAt(0, 0, 0);
  const fill = new THREE.HemisphereLight("#e3ebff", "#202638", 0.5);
  const shadow = new THREE.DirectionalLight("#f6f8ff", 2);
  shadow.position.set(-3, 6, 7);
  shadow.castShadow = true;
  shadow.shadow.mapSize.set(1024, 1024);
  Object.assign(shadow.shadow.camera, {
    left: -8,
    right: 8,
    top: 8,
    bottom: -8,
    near: 0.5,
    far: 30,
  });
  shadow.shadow.camera.updateProjectionMatrix();
  shadow.shadow.bias = -0.00015;
  shadow.shadow.normalBias = 0.012;
  // Blur the depth moments once, then use a single filtered lookup per
  // surface. A broad kernel keeps the studio shadows soft during motion.
  shadow.shadow.radius = 22;
  shadow.shadow.blurSamples = 24;
  shadow.shadow.autoUpdate = false;
  scene.add(key, rim, fill, shadow, shadow.target);
  return {
    aspect,
    environment,
    shadow,
    dispose() {
      environment.dispose();
      shadow.shadow.dispose();
    },
  };
}
