import * as THREE from 'three/webgpu';
import { color, float, mix, positionWorld, uv } from 'three/tsl';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';

// Broad neutral key and fill keep the glass readable; narrow colored panels
// separate the edges. The same panel layout supplies the reflection environment.
const panels = [
  { color: '#f1f5ff', intensity: 4.5, width: 6, height: 5, position: [-3, 8, 2], target: [0, 0.8, 0] },
  { color: '#dae7f3', intensity: 1.8, width: 5, height: 5, position: [4, 4, 7], target: [0, 1.5, 0] },
  { color: '#e0f5ff', intensity: 3, width: 7, height: 1.2, position: [0, 6, -4], target: [0, 1, 0] },
  { color: '#70dfff', intensity: 2.5, width: 1, height: 5, position: [-5, 4, -3], target: [0, 1.5, 0] },
  { color: '#ef9cd8', intensity: 1.8, width: 0.8, height: 4, position: [5, 3.5, -4], target: [0, 1.5, 0] }
];

export function createStudioLighting(renderer) {
  THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  const studio = new THREE.Scene();
  // A neutral studio surround gives transmitted/refracted rays midtones
  // between the softboxes, while the lower hemisphere stays darker.
  const surroundMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  surroundMaterial.colorNode = mix(color('#26313f'), color('#73808f'),
    positionWorld.normalize().y.mul(0.5).add(0.5).smoothstep(0.1, 0.9));
  const surround = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), surroundMaterial);
  studio.add(surround);
  const geometry = new THREE.PlaneGeometry(1, 1);
  for (const panel of panels) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    // Feather the emitting edges instead of reflecting a uniformly bright
    // rectangle. This is a light-source profile, without a bloom pass.
    const edge = uv().sub(0.5).abs().mul(2);
    const feather = float(1).sub(edge.x.smoothstep(0.45, 1))
      .mul(float(1).sub(edge.y.smoothstep(0.45, 1)));
    material.colorNode = color(panel.color).mul(panel.intensity).mul(feather.mul(0.85).add(0.15));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(panel.position); mesh.scale.set(panel.width, panel.height, 1);
    mesh.lookAt(...panel.target); studio.add(mesh);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(studio, 0.025, 0.1, 100, { position: new THREE.Vector3(0, 1.4, 0) });
  for (const mesh of studio.children) mesh.material.dispose();
  surround.geometry.dispose(); geometry.dispose(); pmrem.dispose();
  const rigs = [];
  return {
    environment,
    addTo(scene) {
      const rig = new THREE.Group();
      for (const panel of panels) {
        // LTC area lights use uniform emission; match the softbox's average.
        const light = new THREE.RectAreaLight(panel.color, panel.intensity * 0.65, panel.width, panel.height);
        light.position.fromArray(panel.position); light.lookAt(...panel.target);
        rig.add(light);
      }
      rig.add(new THREE.HemisphereLight('#d6e3ee', '#293344', 0.45));
      scene.add(rig); rigs.push(rig);
    },
    update(position) {
      // Area lights have distance falloff, so the rig travels with the drop
      // point. Their orientation and the baked reflection layout stay aligned.
      for (const rig of rigs) rig.position.copy(position);
    }
  };
}
