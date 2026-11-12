import * as THREE from "three/webgpu";
import {
  attribute,
  color,
  mix,
  positionGeometry,
  normalViewGeometry,
  mx_noise_float,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createLinkGeometry } from "./breaking-chain.js";
import { MINE_RADIUS } from "./mine-simulation.js";
import { STEP } from "./tension-simulation.js";
import { createMarineLife } from "./marine-life.js";
import { buildMoss } from "./moss.js";
import { MINE_EYE, EYE_CENTER } from "./mine-attachment.js";

export function createHardwareMaterials(rustMaterial) {
  // Share the shell's object-space corrosion and relief, including its sparse
  // exposed patches. Weathered fittings retain only broad, subdued reflections.
  const hardware = rustMaterial.clone();
  hardware.name = "Pitted oxide / weathered rings and fasteners";
  hardware.roughnessNode = rustMaterial.roughnessNode.max(0.7);
  hardware.metalnessNode = rustMaterial.metalnessNode.mul(0.55);
  // Small oxide islands interrupt the polished cap rather than dulling all
  // of its metal. The shared corrosion field keeps the patina tied to the mine.
  const spots = mx_noise_float(
    positionGeometry.mul(24).add(attribute("linkData", "vec2").y),
  ).smoothstep(0.02, 0.22);
  const oxide = rustMaterial.metalnessNode
    .oneMinus()
    .smoothstep(0.25, 0.8)
    .mul(spots);
  const tips = rustMaterial.clone();
  tips.name = "Polished steel / spotted oxide / horn tips";
  tips.colorNode = mix(color("#88988f"), rustMaterial.colorNode, oxide);
  tips.metalnessNode = mix(1, rustMaterial.metalnessNode, oxide);
  tips.roughnessNode = mix(0.2, rustMaterial.roughnessNode, oxide);
  tips.normalNode = mix(
    normalViewGeometry,
    rustMaterial.normalNode,
    oxide.mul(0.65),
  ).normalize();
  tips.aoNode = mix(1, rustMaterial.aoNode, oxide);
  const shell = new THREE.MeshStandardNodeMaterial({
    color: "#6f6850",
    roughness: 0.92,
  });
  return { hardware, tips, shell };
}

// Cast shell, overlapping plate seams, individual mounting flanges and bolts.
// Static hardware is merged by material into four draws. Moss, flexible
// algae and air bubbles use their own batched geometry.
// Yield between small geometry batches so the next mine can be prepared while
// the current one is in use, without a single long construction frame.
export function* buildSubmarineMine(
  scene,
  simulation,
  rustMaterial,
  z,
  seed,
  materials,
  particleScene,
) {
  const group = new THREE.Group();
  group.name = "Buoyant naval mine";
  scene.add(group);
  const cast = [],
    metal = [],
    tips = [],
    shells = [];
  let state = (seed + 1) * 17171;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const surfaceVariation = {
    corrosionOffset: (random() - 0.5) * 0.28 - 0.08,
    reliefScale: 0.65 + random() * 0.85,
  };
  const up = new THREE.Vector3(0, 1, 0);
  const identity = new THREE.Quaternion();
  function part(
    geometry,
    position = new THREE.Vector3(),
    rotation = identity,
    bucket = cast,
    scale = new THREE.Vector3(1, 1, 1),
  ) {
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(position, rotation, scale),
    );
    const n = geometry.attributes.position.count;
    geometry.setAttribute(
      "fracture",
      new THREE.Float32BufferAttribute(new Float32Array(n), 1),
    );
    const offsets = new Float32Array(n * 2),
      profile = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      offsets[i * 2] = seed * 0.713 + 0.13;
      offsets[i * 2 + 1] = seed * 0.317;
      profile[i * 2] = surfaceVariation.corrosionOffset;
      profile[i * 2 + 1] = surfaceVariation.reliefScale;
    }
    geometry.setAttribute(
      "linkData",
      new THREE.Float32BufferAttribute(offsets, 2),
    );
    geometry.setAttribute(
      "mineSurface",
      new THREE.Float32BufferAttribute(profile, 2),
    );
    bucket.push(geometry);
  }
  const sphere = new THREE.SphereGeometry(MINE_RADIUS, 128, 96);
  const p = sphere.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const r =
      1 +
      0.0014 * Math.sin(v.x * 27 + v.y * 9) * Math.sin(v.y * 32 - v.z * 19) +
      0.0007 * Math.sin(v.z * 73 + v.x * 42);
    v.multiplyScalar(r);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  sphere.computeVertexNormals();
  const uv = sphere.attributes.uv;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 2.5);
  part(sphere);
  yield;
  const aroundX = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2,
  );
  part(new THREE.CylinderGeometry(1.293, 1.293, 0.075, 192, 1, true));
  for (const y of [-0.046, 0.046])
    part(
      new THREE.TorusGeometry(1.291, 0.012, 8, 192),
      new THREE.Vector3(0, y, 0),
      aroundX,
    );
  for (let i = 0; i < 64; i++) {
    const a = (i * Math.PI * 2) / 64,
      n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    part(
      new THREE.SphereGeometry(0.025, 10, 6),
      n.clone().multiplyScalar(1.3),
      new THREE.Quaternion().setFromUnitVectors(up, n),
      metal,
      new THREE.Vector3(1, 0.55, 1),
    );
  }
  // Two narrow welded meridians break up the forged shell without hiding patina.
  for (const a of [0.35, 1.92])
    part(
      new THREE.TorusGeometry(1.281, 0.006, 6, 160),
      new THREE.Vector3(),
      new THREE.Quaternion().setFromAxisAngle(up, a),
    );
  yield;
  const directions = [new THREE.Vector3(0, 1, 0)];
  for (const [lat, count, phase] of [
    [0.65, 5, 0.25],
    [-0.12, 6, 0.66],
    [-0.79, 4, 0.1],
  ]) {
    for (let i = 0; i < count; i++) {
      const a = (i * Math.PI * 2) / count + phase;
      directions.push(
        new THREE.Vector3(
          Math.cos(lat) * Math.sin(a),
          Math.sin(lat),
          Math.cos(lat) * Math.cos(a),
        ),
      );
    }
  }
  for (const n of directions) {
    yield;
    const q = new THREE.Quaternion().setFromUnitVectors(up, n);
    const at = (d) => n.clone().multiplyScalar(d);
    part(new THREE.CylinderGeometry(0.22, 0.25, 0.065, 40), at(1.282), q);
    part(new THREE.CylinderGeometry(0.165, 0.185, 0.085, 32), at(1.345), q);
    part(new THREE.CylinderGeometry(0.073, 0.142, 0.36, 40, 8), at(1.55), q);
    part(
      new THREE.SphereGeometry(0.074, 24, 16),
      at(1.734),
      q,
      tips,
      new THREE.Vector3(1, 0.86, 1),
    );
    for (const d of [1.38, 1.49, 1.66]) {
      const radius = 0.142 - ((d - 1.37) / 0.36) * 0.069;
      const tq = q.clone().multiply(aroundX);
      part(
        new THREE.TorusGeometry(radius + 0.001, 0.006, 6, 40),
        at(d),
        tq,
        metal,
      );
    }
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4,
        offset = new THREE.Vector3(
          Math.cos(a) * 0.202,
          0.05,
          Math.sin(a) * 0.202,
        ).applyQuaternion(q);
      part(
        new THREE.CylinderGeometry(0.023, 0.025, 0.025, 6),
        at(1.28).add(offset),
        q,
        metal,
      );
    }
  }
  yield;
  // A bolted bottom collar and a thick forged eye visibly embrace the first link.
  part(
    new THREE.CylinderGeometry(0.27, 0.25, 0.16, 48),
    new THREE.Vector3(0, -1.29, 0),
  );
  part(
    new THREE.CylinderGeometry(0.3, 0.3, 0.055, 48),
    new THREE.Vector3(0, -1.37, 0),
  );
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    part(
      new THREE.CylinderGeometry(0.035, 0.035, 0.035, 6),
      new THREE.Vector3(Math.cos(a) * 0.246, -1.411, Math.sin(a) * 0.246),
      identity,
      metal,
    );
  }
  part(
    createLinkGeometry({
      shape: MINE_EYE,
    }),
    new THREE.Vector3(...EYE_CENTER),
  );
  // Barnacles grow in uneven small colonies along the lower plates and flanges.
  for (let cluster = 0; cluster < 15; cluster++) {
    yield;
    const a = random() * Math.PI * 2,
      latitude = (random() - 0.55) * 1.5;
    for (let i = 0; i < 3 + random() * 6; i++) {
      const theta = a + (random() - 0.5) * 0.22,
        lat = latitude + (random() - 0.5) * 0.18;
      const n = new THREE.Vector3(
        Math.cos(lat) * Math.sin(theta),
        Math.sin(lat),
        Math.cos(lat) * Math.cos(theta),
      );
      const size = 0.018 + random() * 0.024,
        height = size * (0.8 + random() * 0.5);
      const points = [
        new THREE.Vector2(size, 0),
        new THREE.Vector2(size * 0.68, height * 0.8),
        new THREE.Vector2(size * 0.5, height),
        new THREE.Vector2(size * 0.3, height * 0.94),
        new THREE.Vector2(size * 0.22, height * 0.25),
      ];
      part(
        new THREE.LatheGeometry(points, 9),
        n.clone().multiplyScalar(1.282),
        new THREE.Quaternion().setFromUnitVectors(up, n),
        shells,
      );
    }
  }
  const { hardware, tips: tipMaterial, shell } = materials;
  const meshes = [];
  for (const [pieces, material, name] of [
    [cast, rustMaterial, "Corroded shell and horn mounts"],
    [metal, hardware, "Corroded rings and rivets"],
    [tips, tipMaterial, "Horn tips with patchy oxide"],
    [shells, shell, "Barnacle colonies"],
  ]) {
    const geometry = mergeGeometries(pieces, false);
    pieces.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    yield;
  }
  const marine = createMarineLife(
    scene,
    simulation,
    z,
    random,
    materials,
    particleScene,
  );
  yield;
  const moss = yield* buildMoss(group, directions, seed, materials);
  const position = new THREE.Vector3(),
    quaternion = new THREE.Quaternion();
  function update(interpolate = true) {
    const a = interpolate
        ? Math.max(0, Math.min(1, simulation.accumulator / STEP))
        : 1,
      body = simulation.mine;
    group.position
      .fromArray(body.previousPosition)
      .lerp(position.fromArray(body.position), a);
    group.position.z += z;
    group.quaternion
      .fromArray(body.previousQuaternion)
      .slerp(quaternion.fromArray(body.quaternion), a);
    marine.update();
    moss.update(simulation.time, body);
  }
  update(false);
  return {
    group,
    meshes,
    surfaceVariation,
    marine,
    moss,
    advance: marine.advance,
    update,
    dispose() {
      scene.remove(group);
      meshes.forEach((m) => m.geometry.dispose());
      marine.dispose();
      moss.dispose();
    },
  };
}
