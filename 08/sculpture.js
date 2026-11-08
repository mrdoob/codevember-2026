import * as THREE from "three/webgpu";
import { attribute } from "three/tsl";
import { EDGES, VERTICES, project4, transform4 } from "./hypercube.js";
import { TubeAreaLight, tubeMaterial } from "./tube-area-light.js";
import { tubeColor, tubeBlink } from "./neon-pattern.js";
export { NEON_COLORS } from "./neon-pattern.js";
import {
  FLOOR_Y,
  CEILING_Y,
  CEILING_FIXTURE_DEPTH,
  ROOM_HALF_WIDTH,
  ROOM_BACK_Z,
} from "./room-layout.js";
export { FLOOR_Y } from "./room-layout.js";

export const SCULPTURE_SCALE = 4;
export const FLOAT_HEIGHT = (FLOOR_Y + CEILING_Y - CEILING_FIXTURE_DEPTH) / 2;
export const SURFACE_CLEARANCE = 0.08;
export const MIN_PERSPECTIVE = 2.8;
export const MAX_PERSPECTIVE = 7;
export const TUBE_TRANSMISSION = 0.82;
export const DEFAULT_TUBE_RADIUS = 0.035;
export const MAX_TUBE_RADIUS = 0.06;

export function projectedInstallation(matrix, perspective) {
  const points = VERTICES.map((point) =>
    project4(transform4(point, matrix), perspective, SCULPTURE_SCALE),
  );
  // Fit the complete projection uniformly about its fixed origin. The margin
  // includes the largest fittings, so tubes cannot touch the floor or rafters.
  const padding = SURFACE_CLEARANCE + MAX_TUBE_RADIUS * 2.2;
  const floorSpace = FLOAT_HEIGHT - FLOOR_Y - padding;
  const roofSpace = CEILING_Y - CEILING_FIXTURE_DEPTH - FLOAT_HEIGHT - padding;
  let fit = 1;
  for (const [x, y, z] of points) {
    if (y < 0) fit = Math.min(fit, floorSpace / -y);
    if (y > 0) fit = Math.min(fit, roofSpace / y);
    if (x !== 0) fit = Math.min(fit, (ROOM_HALF_WIDTH - padding) / Math.abs(x));
    if (z < 0) fit = Math.min(fit, (-ROOM_BACK_Z - padding) / -z);
  }
  return points.map(([x, y, z]) => [x * fit, y * fit + FLOAT_HEIGHT, z * fit]);
}

export function createSculpture(settings) {
  const group = new THREE.Group(),
    count = EDGES.length;
  const material = tubeMaterial({
    color: "#d8dbe2",
    roughness: 0.34,
    metalness: 0,
  });
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
  const radiance = new THREE.InstancedBufferAttribute(
    new Float32Array(count * 3),
    3,
  ).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("tubeRadiance", radiance);
  // A continuous phosphor diffuser. The white, rough glass remains lit by
  // neighboring tubes when its own phosphor switches off.
  material.emissiveNode = attribute("tubeRadiance", "vec3").mul(
    TUBE_TRANSMISSION,
  );
  const tubes = new THREE.InstancedMesh(geometry, material, count);
  tubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tubes.frustumCulled = false;
  group.add(tubes);

  const hardware = tubeMaterial({
    color: "#626d79",
    metalness: 0.82,
    roughness: 0.34,
  });
  const ceramic = tubeMaterial({
    color: "#bec3cb",
    metalness: 0,
    roughness: 0.36,
  });
  const nickel = tubeMaterial({
    color: "#a3a5a1",
    metalness: 0.88,
    roughness: 0.25,
  });
  // Stepped, faceted socket bodies, with recessed necks and retaining rings.
  const profile = [
    [0, -0.5],
    [1.4, -0.5],
    [1.4, -0.38],
    [1.7, -0.32],
    [1.7, -0.12],
    [1.35, -0.06],
    [1.35, 0.1],
    [1.55, 0.16],
    [1.55, 0.3],
    [1.15, 0.35],
    [1.15, 0.5],
    [0, 0.5],
  ];
  const collars = new THREE.InstancedMesh(
    new THREE.LatheGeometry(
      profile.map((p) => new THREE.Vector2(...p)),
      12,
    ),
    hardware,
    count * 2,
  );
  const joints = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    hardware,
    VERTICES.length,
  );
  const sockets = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 16),
    ceramic,
    count * 2,
  );
  const ringGeometry = new THREE.TorusGeometry(1.2, 0.12, 6, 16);
  ringGeometry.rotateX(Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeometry, nickel, count * 4);
  const fittings = [collars, joints, sockets, rings];
  for (const mesh of fittings) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const lights = Array.from({ length: count }, () => {
    const light = new TubeAreaLight(0xffffff, settings.power, settings.radius);
    group.add(light);
    return light;
  });
  const dummy = new THREE.Object3D(),
    up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    direction = new THREE.Vector3();
  const socketDirection = new THREE.Vector3();
  const tints = Array.from({ length: count }, () => new THREE.Color());
  const blinkLevels = new Float32Array(count);
  let vertices = [],
    colorMode = null;
  function update(matrix, time = 0) {
    vertices = projectedInstallation(matrix, settings.perspective);
    if (colorMode !== settings.color) {
      colorMode = settings.color;
      tints.forEach((tint, index) => tint.set(tubeColor(index, colorMode)));
    }
    const power =
      settings.power *
      (1 +
        settings.flicker *
          (Math.sin(time * 21.7) * 0.025 + Math.sin(time * 37.1) * 0.015));
    EDGES.forEach(([start, end], index) => {
      const blink = settings.blinking
        ? tubeBlink(index, time, settings.blinkSpeed ?? 1)
        : 1;
      const tint = tints[index],
        edgePower = power * blink;
      blinkLevels[index] = blink;
      radiance.setXYZ(
        index,
        tint.r * edgePower,
        tint.g * edgePower,
        tint.b * edgePower,
      );
      a.fromArray(vertices[start]);
      b.fromArray(vertices[end]);
      const length = direction.subVectors(b, a).length();
      direction.divideScalar(Math.max(length, 1e-6));
      const inset = Math.min(0.014, length * 0.45);
      dummy.quaternion.setFromUnitVectors(up, direction);
      dummy.position.copy(a).add(b).multiplyScalar(0.5);
      dummy.scale.set(
        settings.radius,
        Math.max(0.001, length - 2 * inset),
        settings.radius,
      );
      dummy.updateMatrix();
      tubes.setMatrixAt(index, dummy.matrix);
      const fittingLength = Math.min(settings.radius * 4.2, length * 0.22);
      for (let cap = 0; cap < 2; cap++) {
        const end = cap ? b : a,
          sign = cap ? -1 : 1;
        dummy.quaternion.setFromUnitVectors(
          up,
          socketDirection.copy(direction).multiplyScalar(sign),
        );
        dummy.position
          .copy(end)
          .addScaledVector(direction, sign * fittingLength * 0.38);
        dummy.scale.set(settings.radius, fittingLength * 0.76, settings.radius);
        dummy.updateMatrix();
        collars.setMatrixAt(index * 2 + cap, dummy.matrix);
        dummy.position
          .copy(end)
          .addScaledVector(direction, sign * fittingLength * 0.8);
        dummy.scale.set(
          settings.radius * 1.12,
          fittingLength * 0.6,
          settings.radius * 1.12,
        );
        dummy.updateMatrix();
        sockets.setMatrixAt(index * 2 + cap, dummy.matrix);
        for (let ring = 0; ring < 2; ring++) {
          dummy.position
            .copy(end)
            .addScaledVector(
              direction,
              sign * fittingLength * (ring ? 1.07 : 0.61),
            );
          dummy.scale.setScalar(settings.radius);
          dummy.updateMatrix();
          rings.setMatrixAt(index * 4 + cap * 2 + ring, dummy.matrix);
        }
      }
      const light = lights[index];
      light.start.copy(a).addScaledVector(direction, inset);
      light.end.copy(b).addScaledVector(direction, -inset);
      light.radius = settings.radius;
      light.color.copy(tint);
      // The diffuser and area emitter share the same transmitted radiance.
      light.intensity = settings.illumination
        ? edgePower *
          TUBE_TRANSMISSION *
          THREE.MathUtils.smoothstep(length, 0.025, 0.06)
        : 0;
    });
    vertices.forEach((point, index) => {
      dummy.position.fromArray(point);
      dummy.quaternion.identity();
      dummy.scale.setScalar(settings.radius * 2.2);
      dummy.updateMatrix();
      joints.setMatrixAt(index, dummy.matrix);
    });
    for (const mesh of [tubes, ...fittings])
      mesh.instanceMatrix.needsUpdate = true;
    radiance.needsUpdate = true;
  }
  return {
    group,
    tubes,
    collars,
    joints,
    sockets,
    rings,
    lights,
    material,
    blinkLevels,
    update,
    get vertices() {
      return vertices;
    },
    dispose() {
      for (const mesh of [tubes, ...fittings]) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      material.dispose();
      hardware.dispose();
      ceramic.dispose();
      nickel.dispose();
      lights.forEach((light) => light.dispose());
    },
  };
}
