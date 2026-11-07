import * as THREE from "three/webgpu";
import { Fn, cubeTexture, pmremTexture, vec3 } from "three/tsl";
import { createGeometries } from "./geometry.js";
import { layerState, seeded, SHELL_LIFETIME } from "./journey.js";
import { orbitYaw } from "./camera-motion.js";
import { createMaterials } from "./materials.js";

const POOL_SIZE = 8;
const DESCENDANTS = 3;
const PROBE_SIZE = 64;
const reflectionWeights = Array.from({ length: 16 }, (_, i) =>
  Math.exp((-2 * (i + 0.5)) / 16),
);
const reflectionWeightSum = reflectionWeights.reduce((a, b) => a + b);

// Composite the enclosing shell over the studio's filtered environment.
// A weighted cone softens the local layer without rebuilding its PMREM.
function localReflection(environment, probe) {
  const room = pmremTexture(environment);
  return Fn((_, builder) => {
    const direction = builder.context.getUV().toVar();
    const roughness = builder.context.getTextureLevel();
    const radius = roughness.mul(roughness).mul(1.6).toVar();
    const tangent = direction
      .cross(vec3(0.0001, 1, 0))
      .normalize()
      .mul(radius)
      .toVar();
    const bitangent = direction.cross(tangent).toVar();
    const sample = cubeTexture(probe, direction, 0).mul(0.08).toVar();
    for (let i = 0; i < reflectionWeights.length; i++) {
      const r = Math.sqrt((i + 0.5) / reflectionWeights.length),
        angle = i * 2.3999632297;
      const offset = tangent
        .mul(r * Math.cos(angle))
        .add(bitangent.mul(r * Math.sin(angle)));
      sample.addAssign(
        cubeTexture(probe, direction.add(offset), 0).mul(
          (reflectionWeights[i] / reflectionWeightSum) * 0.92,
        ),
      );
    }
    return room.mul(sample.a.oneMinus()).add(sample.rgb);
  })();
}

function setHinge(half, contour, id) {
  // A supporting point on the actual rim keeps the hinge outside the shell.
  // Both X and Z contribute; opposing signs tip each half outward.
  const salt = half.sign > 0 ? 421 : 811;
  const bearing =
    ((Math.floor(seeded(id, salt) * 4) + 0.25 + seeded(id, salt + 1) * 0.5) *
      Math.PI) /
    2;
  const x = Math.cos(bearing),
    z = Math.sin(bearing);
  let support = -Infinity;
  for (const p of contour) {
    const distance = p[0] * half.sign * x + p[2] * z;
    if (distance > support) {
      support = distance;
      half.anchor.set(p[0] * half.sign, p[1] * half.sign, p[2]);
    }
  }
  half.pivot.position.copy(half.anchor);
  half.body.position.copy(half.anchor).negate();
  half.hingeAxis.set(z * half.sign, 0, -x * half.sign);
  half.hingeScale = 0.75 + seeded(id, salt + 2) * 0.25;
}

function setOuterMaterial(slot, material) {
  slot.solid.material = material;
  for (const half of slot.halves) half.meshes[0].material = material;
}

export function createShells(environment, background) {
  const geometry = createGeometries();
  const group = new THREE.Group();
  const materials = createMaterials(background);
  const silver = materials.metal();
  const edge = materials.fadeMaterial(
    new THREE.MeshPhysicalNodeMaterial({
      color: "#555b65",
      metalness: 1,
      roughness: 0.19,
    }),
  );
  const linings = materials.linings;
  const up = new THREE.Vector3(0, 1, 0),
    travel = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  // Keep the current split and its immediate parent. Older shells leave the
  // scene when the second subsequent split starts, and their slots are reused.
  const slots = [];
  function createSlot() {
    const root = new THREE.Group();
    const metal = materials.metal();
    const lining = materials.lining();
    const probe = new THREE.CubeRenderTarget(PROBE_SIZE, {
      type: THREE.HalfFloatType,
    });
    const probeCamera = new THREE.CubeCamera(0.03, 85, probe);
    metal.envNode = localReflection(environment, probe.texture);
    const halves = [1, -1].map((sign) => {
      const carrier = new THREE.Group(),
        pivot = new THREE.Group(),
        half = new THREE.Group();
      if (sign < 0) half.rotation.z = Math.PI;
      const meshes = [metal, lining, edge, lining].map((material) => {
        const mesh = new THREE.Mesh(geometry.shapes[0].outer, material);
        mesh.userData.surfaceSign = sign;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        half.add(mesh);
        return mesh;
      });
      pivot.add(half);
      carrier.add(pivot);
      root.add(carrier);
      return {
        sign,
        carrier,
        pivot,
        body: half,
        meshes,
        anchor: new THREE.Vector3(),
        hingeAxis: new THREE.Vector3(),
        hingeScale: 1,
      };
    });
    const solid = new THREE.Mesh(geometry.shapes[0].solid, metal);
    solid.castShadow = true;
    solid.receiveShadow = true;
    root.add(solid);
    root.visible = false;
    const slot = {
      root,
      halves,
      solid,
      metal,
      lining,
      probe,
      probeCamera,
      orientation: new THREE.Quaternion(),
      openingAxis: new THREE.Vector3(),
      id: -Infinity,
      state: null,
      probeReady: false,
      active: false,
    };
    slots.push(slot);
    return slot;
  }
  for (let i = 0; i < POOL_SIZE; i++) createSlot();

  function activate(slot, state) {
    slot.id = state.id;
    slot.active = true;
    slot.probeReady = false;
    slot.openingAxis.set(
      Math.cos(state.bearing) * Math.cos(state.tilt),
      Math.sin(state.bearing) * Math.cos(state.tilt),
      Math.sin(state.tilt),
    );
    slot.orientation
      .setFromUnitVectors(up, slot.openingAxis)
      .multiply(rotation.setFromAxisAngle(up, state.spinOffset));
    materials.setLiningColor(slot.lining, state.color);
    const shape = geometry.shapes[state.shape];
    slot.solid.geometry = shape.solid;
    for (const half of slot.halves) {
      setHinge(half, shape.contour, state.id);
      half.meshes[0].geometry = shape.outer;
      half.meshes[1].geometry = shape.inner;
      half.meshes[2].geometry = shape.rim;
      half.meshes[3].geometry = shape.liningRim;
    }
    group.add(slot.root);
  }

  let lastDepth = null;
  function update(journey, settings, turnY = 0) {
    group.rotation.y = orbitYaw(journey.depth, turnY, settings.orbit !== false);
    const seeking =
      lastDepth === null ||
      journey.depth < lastDepth - 1e-7 ||
      journey.depth - lastDepth > 1.1;
    const firstId = Math.max(0, journey.index - SHELL_LIFETIME + 1);
    for (const slot of slots) {
      if (slot.active && (seeking || slot.id < firstId)) {
        slot.active = false;
        slot.root.visible = false;
        group.remove(slot.root);
      }
    }
    // Seeking and playback use the same two-generation lifetime.
    for (let id = firstId; id <= journey.index + DESCENDANTS; id++) {
      if (slots.some((slot) => slot.active && slot.id === id)) continue;
      const slot = slots.find((slot) => !slot.active) || createSlot();
      activate(
        slot,
        layerState(journey.index, journey.phase, id - journey.index),
      );
    }
    for (const slot of slots) {
      if (!slot.active) continue;
      const state = layerState(
        journey.index,
        journey.phase,
        slot.id - journey.index,
      );
      slot.root.visible = true;
      slot.state = state;
      slot.solid.visible = state.opening === 0;
      slot.root.scale.setScalar(state.scale);
      slot.solid.quaternion
        .copy(slot.orientation)
        .multiply(rotation.setFromAxisAngle(up, state.spin));
      slot.solid.userData.fade = state.fade;
      travel.copy(slot.openingAxis).multiplyScalar(state.separation);
      for (const half of slot.halves) {
        half.pivot.visible = !slot.solid.visible;
        half.carrier.position.copy(travel).multiplyScalar(half.sign);
        // Both halves inherit the body's uninterrupted spin, preserving
        // its axis, direction, and angular speed through the split.
        half.carrier.quaternion.copy(slot.solid.quaternion);
        half.pivot.quaternion.setFromAxisAngle(
          half.hingeAxis,
          state.hinge * half.hingeScale,
        );
        for (const mesh of half.meshes) mesh.userData.fade = state.fade;
      }
    }
    lastDepth = journey.depth;
    materials.roughness.value = settings.roughness;
  }

  const bounds = new THREE.Sphere();
  function updateCameraRange(camera) {
    camera.updateMatrixWorld(true);
    group.updateMatrixWorld(true);
    let far = 90;
    for (const slot of slots) {
      if (!slot.active) continue;
      for (const half of slot.halves) {
        const mesh = half.meshes[0];
        bounds
          .copy(mesh.geometry.boundingSphere)
          .applyMatrix4(mesh.matrixWorld);
        far = Math.max(
          far,
          camera.position.distanceTo(bounds.center) + bounds.radius + 5,
        );
      }
    }
    if (Math.abs(camera.far - far) > 0.01) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }

  function reflect(renderer, scene, journey, enabled) {
    const visibility = slots.map((slot) => slot.root.visible);
    const background = scene.backgroundNode;
    const mapping = renderer.toneMapping;
    const oldTarget = renderer.getRenderTarget();
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    scene.backgroundNode = null;
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    materials.probeCapture.value = 1;
    try {
      // Use the static environment during capture to avoid feedback between probes.
      for (const slot of slots) setOuterMaterial(slot, silver);
      // Capture only a shell's immediate container. Each slot has its own
      // texture, so a cube face can never sample the attachment being written.
      // Two small probes are refreshed; hidden descendants reuse their probe.
      const ordered = [...slots].sort((a, b) => a.id - b.id);
      for (const slot of ordered) {
        if (!slot.active) continue;
        if (
          slot.probeReady &&
          (!enabled ||
            slot.id <= 0 ||
            slot.id < journey.index ||
            slot.id > journey.index + 1)
        )
          continue;
        for (const candidate of slots)
          candidate.root.visible =
            enabled && candidate.active && candidate.id === slot.id - 1;
        slot.probeCamera.update(renderer, scene);
        slot.probeReady = true;
      }
    } finally {
      materials.probeCapture.value = 0;
      slots.forEach((slot, i) => {
        slot.root.visible = visibility[i];
      });
      for (const slot of slots) setOuterMaterial(slot, slot.metal);
      scene.backgroundNode = background;
      renderer.toneMapping = mapping;
      renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(clearColor, clearAlpha);
    }
  }
  return {
    group,
    slots,
    geometry,
    silver,
    linings,
    update,
    updateCameraRange,
    reflect,
    dispose() {
      geometry.dispose();
      materials.dispose();
      silver.dispose();
      edge.dispose();
      slots.forEach((slot) => {
        slot.metal.dispose();
        slot.probe.dispose();
      });
    },
  };
}
