import * as THREE from "three/webgpu";
import {
  normalView,
  positionView,
  attribute,
  float,
  vec3,
  color,
  mix,
} from "three/tsl";
import { SeaweedSimulation } from "./seaweed-simulation.js";
import { createAlgaeRoots } from "./algae-roots.js";

export function createMarineMaterials(opaqueViewZ, atmosphere) {
  const algae = new THREE.MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const bubbleMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // Air has almost no visible interior. A thin rim and two reflected light
  // arcs read as water/air without metallic shading or a transmission pass.
  const fresnel = float(1)
    .sub(normalView.dot(positionView.negate().normalize()).max(0))
    .pow(3.5);
  const highlight = normalView
    .dot(vec3(-0.45, 0.7, 0.55).normalize())
    .max(0)
    .pow(28);
  const rimLight = normalView
    .dot(vec3(0.7, -0.3, 0.4).normalize())
    .max(0)
    .pow(18);
  bubbleMaterial.colorNode = mix(
    color("#9cd5e3"),
    color("#e2fff9"),
    highlight.add(fresnel.mul(0.45)).clamp(),
  );
  bubbleMaterial.opacityNode = fresnel
    .mul(normalView.y.mul(0.12).add(0.34))
    .add(highlight.mul(0.62))
    .add(rimLight.mul(0.12))
    .mul(attribute("bubbleAlpha", "float"))
    .mul(positionView.z.sub(opaqueViewZ).smoothstep(0, 0.025))
    .mul(atmosphere.fogAmount(atmosphere.fogDistance).oneMinus().sqrt());
  return { algae, bubbleMaterial };
}

export function createMarineLife(
  scene,
  simulation,
  z,
  random,
  materials,
  particleScene,
) {
  const roots = createAlgaeRoots(simulation, random);
  const physics = new SeaweedSimulation(roots, simulation.mine, z),
    sides = 4,
    nodes = 9;
  const geometry = new THREE.BufferGeometry(),
    positions = new Float32Array(roots.length * nodes * sides * 3),
    normals = new Float32Array(positions.length),
    colors = new Float32Array(positions.length),
    indices = [];
  for (let j = 0; j < roots.length; j++)
    for (let i = 0; i < nodes; i++)
      for (let s = 0; s < sides; s++) {
        const index = (j * nodes + i) * sides + s;
        const tone = new THREE.Color().setRGB(
          0.032 + (0.03 * i) / nodes,
          0.055 + (0.045 * i) / nodes,
          0.008,
        );
        tone.toArray(colors, index * 3);
        if (i < nodes - 1) {
          const next = (s + 1) % sides;
          const a = (j * nodes + i) * sides + s,
            b = (j * nodes + i) * sides + next;
          indices.push(a, b, a + sides, b, b + sides, a + sides);
        }
      }
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = materials.algae;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Flexible marine algae";
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const bubblesGeometry = new THREE.SphereGeometry(1, 20, 14),
    alphas = new Float32Array(64);
  bubblesGeometry.setAttribute(
    "bubbleAlpha",
    new THREE.InstancedBufferAttribute(alphas, 1),
  );
  const bubbleMaterial = materials.bubbleMaterial;
  const bubbles = new THREE.InstancedMesh(bubblesGeometry, bubbleMaterial, 64);
  bubbles.name = "Buoyant escaping air";
  bubbles.frustumCulled = false;
  particleScene.add(bubbles);
  const bubbleStates = Array.from({ length: 64 }, (_, i) => ({
    age: -i * 0.12,
    life: 6 + random() * 3,
    size: 0.01 + random() ** 2 * 0.027,
    phase: random() * 6.28,
    p: new THREE.Vector3(),
    v: new THREE.Vector3(),
  }));
  const sources = [
    new THREE.Vector3(0.66, 0.9, 0.65).normalize().multiplyScalar(1.3),
    new THREE.Vector3(-0.86, 0.5, 0.7).normalize().multiplyScalar(1.3),
    new THREE.Vector3(1, 0.1, 0.85).normalize().multiplyScalar(1.3),
  ];
  const bodyPosition = new THREE.Vector3(),
    bodyRotation = new THREE.Quaternion(),
    delta = new THREE.Vector3();
  function birth(b, i) {
    b.p
      .copy(sources[i % sources.length])
      .applyQuaternion(bodyRotation)
      .add(bodyPosition);
    b.v
      .fromArray(simulation.mine.velocity)
      .multiplyScalar(0.35)
      .add(
        new THREE.Vector3(
          Math.sin(b.phase) * 0.03,
          0.24,
          Math.cos(b.phase) * 0.03,
        ),
      );
  }
  function advance(dt) {
    physics.advance(dt, simulation.mine);
    bodyPosition.fromArray(simulation.mine.position);
    bodyPosition.z += z;
    bodyRotation.fromArray(simulation.mine.quaternion);
    bubbleStates.forEach((b, i) => {
      const previous = b.age;
      b.age += dt;
      if (b.age < 0) return;
      if (previous <= 0 || b.age > b.life) {
        b.age = Math.max(0, b.age % b.life);
        birth(b, i);
      }
      const blend = 1 - Math.exp(-dt * 2.2);
      b.v.x += (Math.sin(physics.time * 1.8 + b.phase) * 0.04 - b.v.x) * blend;
      const riseSpeed = (0.35 + b.size * 7) * 1.35;
      b.v.y += (riseSpeed - b.v.y) * blend;
      b.v.z += (Math.cos(physics.time * 1.4 + b.phase) * 0.03 - b.v.z) * blend;
      b.p.addScaledVector(b.v, dt);
      delta.copy(b.p).sub(bodyPosition);
      if (delta.length() < 1.3)
        b.p.copy(delta.normalize().multiplyScalar(1.3)).add(bodyPosition);
    });
  }
  const tangent = new THREE.Vector3(),
    side = new THREE.Vector3(),
    binormal = new THREE.Vector3(),
    p = new THREE.Vector3(),
    n = new THREE.Vector3(),
    pose = new THREE.Object3D();
  function update() {
    physics.strands.forEach((strand, j) =>
      strand.points.forEach((point, i) => {
        const a = strand.points[Math.max(0, i - 1)],
          b = strand.points[Math.min(nodes - 1, i + 1)];
        tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
        side.set(0, 0, 1).cross(tangent).normalize();
        if (side.lengthSq() < 0.1) side.set(1, 0, 0);
        binormal.crossVectors(tangent, side).normalize();
        for (let s = 0; s < sides; s++) {
          const angle = (s / sides) * Math.PI * 2,
            index = ((j * nodes + i) * sides + s) * 3;
          n.copy(side)
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(binormal, Math.sin(angle));
          p.fromArray(point).addScaledVector(
            n,
            strand.width * (1 - (i / nodes) * 0.85),
          );
          p.toArray(positions, index);
          n.toArray(normals, index);
        }
      }),
    );
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    bubbleStates.forEach((b, i) => {
      pose.position.copy(b.p);
      const size = b.age < 0 ? 0 : b.size * (1 + b.age * 0.035);
      const wobble = Math.sin(b.age * 4 + b.phase) * 0.06;
      pose.scale.set(
        size * (1 + wobble),
        size * (1.08 - wobble * 0.5),
        size * (1 - wobble),
      );
      pose.updateMatrix();
      bubbles.setMatrixAt(i, pose.matrix);
      alphas[i] = b.age < 0 ? 0 : Math.min(1, b.age * 5, (b.life - b.age) * 2);
    });
    bubbles.instanceMatrix.needsUpdate = true;
    bubblesGeometry.attributes.bubbleAlpha.needsUpdate = true;
  }
  // The mine enters below the frame; its normal ascent settles the strands.
  // Hundreds of synchronous warm-up steps here stalled every replacement.
  advance(0);
  update();
  return {
    physics,
    bubbles,
    bubbleStates,
    advance,
    update,
    dispose() {
      scene.remove(mesh);
      particleScene.remove(bubbles);
      geometry.dispose();
      bubblesGeometry.dispose();
      bubbles.dispose();
    },
  };
}
