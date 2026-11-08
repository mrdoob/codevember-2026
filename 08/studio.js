import * as THREE from "three/webgpu";
import {
  cameraPosition,
  color,
  lights,
  positionWorld,
  texture,
  uniform,
  bumpMap,
  normalWorld,
  triplanarTexture,
  output,
  vec4,
} from "three/tsl";
import { tubeMaterial } from "./tube-area-light.js";
import {
  FLOOR_Y,
  CEILING_Y,
  ROOM_HALF_WIDTH,
  COLUMN_LOCATIONS,
  COLUMN_BASE_WIDTH,
  COLUMN_SHAFT_WIDTH,
  ENVIRONMENT_HALF_SIZE,
  CEILING_BAY_OFFSETS,
} from "./room-layout.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createConcreteTexture } from "./concrete-texture.js";
import { buildCeiling } from "./ceiling.js";
import { createCeilingLights } from "./ceiling-lights.js";
import { createColumnShadows } from "./column-shadows.js";

function makeGrain() {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  const hash = (x, y) => {
    let n = Math.imul(x + 13, 374761393) ^ Math.imul(y + 47, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const value =
        0.5 +
        (hash(x, y) - 0.5) * 0.52 +
        (hash(Math.floor(x / 8), Math.floor(y / 8)) - 0.5) * 0.24;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(value * 255);
      data[i + 3] = 255;
    }
  const map = new THREE.DataTexture(data, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

// Merge each material once; repeated ceiling bays share the merged geometry.
function batchMeshes(parts, offsets = null) {
  const batches = new Map(),
    originals = new Set(),
    meshes = [];
  for (const mesh of parts.children) {
    mesh.updateMatrix();
    originals.add(mesh.geometry);
    const batch = batches.get(mesh.material) ?? [];
    const geometry = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();
    batch.push(geometry.applyMatrix4(mesh.matrix));
    batches.set(mesh.material, batch);
  }
  parts.clear();
  for (const [material, batch] of batches) {
    const geometry = mergeGeometries(batch);
    batch.forEach((part) => part.dispose());
    const mesh = offsets
      ? new THREE.InstancedMesh(geometry, material, offsets.length)
      : new THREE.Mesh(geometry, material);
    if (offsets) {
      const matrix = new THREE.Matrix4();
      offsets.forEach((offset, i) =>
        mesh.setMatrixAt(i, matrix.makeTranslation(...offset)),
      );
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    meshes.push(mesh);
  }
  originals.forEach((geometry) => geometry.dispose());
  return meshes;
}

export function createStudio(scene, settings) {
  scene.background = new THREE.Color("#010103");
  const group = new THREE.Group();
  scene.add(group);
  const grain = makeGrain(),
    concrete = createConcreteTexture(),
    roughness = uniform(settings.floorRoughness);
  const roughnessMax = uniform(settings.floorRoughnessMax);
  const textureLow = uniform(settings.floorTextureLow),
    textureHigh = uniform(settings.floorTextureHigh);
  const columnShadows = createColumnShadows(settings);
  const floor = tubeMaterial(
    { color: "#686970", roughness: settings.floorRoughness, metalness: 0 },
    columnShadows,
  );
  floor.outputNode = vec4(output.rgb.mul(columnShadows.contact), output.a);
  const p = positionWorld.xz,
    tile = p.div(4.5);
  const cell = tile.fract(),
    edge = cell.min(cell.oneMinus());
  // Narrow expansion cuts across large concrete pours, filtered at distance.
  const footprint = tile.fwidth().max(0.0001);
  const coverage = edge.sub(0.0012).div(footprint).add(0.5).clamp(0, 1);
  const seam = coverage.x.mul(coverage.y);
  const surface = texture(concrete, p.mul(0.045));
  floor.colorNode = color("#686970")
    .mul(surface.r.mul(0.08).add(0.96))
    .mul(seam.mul(0.3).add(0.7));
  // Layered fractal wear gives broad patches detail down to fine scuffs.
  // This only changes gloss; the coating keeps its smooth geometric normal.
  const wearNoise = texture(concrete, p.mul(0.0225)).a;
  const fineWear = texture(concrete, p.mul(0.09).add(0.37)).a.smoothstep(
    0.25,
    0.75,
  );
  const wornPatches = wearNoise
    .mul(0.8)
    .add(fineWear.mul(0.2))
    .smoothstep(textureLow, textureHigh.max(textureLow.add(0.0001)));
  const patchWeight = wornPatches.mul(fineWear.mul(0.2).add(0.22)).div(0.42);
  const upperRoughness = roughnessMax.max(roughness);
  floor.roughnessNode = roughness
    .add(patchWeight.mul(upperRoughness.sub(roughness)))
    .add(seam.oneMinus().mul(0.08))
    .clamp(roughness, upperRoughness);
  const column = tubeMaterial({
    color: "#626268",
    roughness: 0.72,
    metalness: 0,
  });
  const columnSurface = triplanarTexture(
    texture(concrete),
    null,
    null,
    0.15,
    positionWorld,
    normalWorld,
  );
  const formwork = positionWorld.y.mul(0.82).fract();
  const formSeam = formwork.min(formwork.oneMinus()).smoothstep(0.002, 0.012);
  column.colorNode = color("#626268")
    .mul(columnSurface.r.mul(0.45).add(0.72))
    .mul(formSeam.mul(0.12).add(0.88));
  column.roughnessNode = columnSurface.g.mul(0.22).add(0.62);
  column.normalNode = bumpMap(columnSurface.b, 0.035);
  const wall = tubeMaterial({
    color: "#3b3d43",
    roughness: 0.82,
    metalness: 0.04,
  });
  const wallGrain = texture(grain, positionWorld.xy.mul(0.4));
  wall.colorNode = color("#3b3d43").mul(wallGrain.r.mul(0.25).add(0.75));
  wall.normalNode = bumpMap(wallGrain, 0.014);
  // Reveal the installation when a full orbit takes the camera outside a side
  // wall. The opposite wall remains, and interior views retain both walls.
  wall.maskNode = positionWorld.x
    .mul(cameraPosition.x)
    .lessThan(0)
    .or(cameraPosition.x.abs().lessThan(ROOM_HALF_WIDTH - 0.6));
  const steel = tubeMaterial({
    color: "#414751",
    roughness: 0.55,
    metalness: 0.68,
  });
  const deck = tubeMaterial({
    color: "#45474e",
    roughness: 0.86,
    metalness: 0,
  });
  deck.colorNode = color("#45474e").mul(
    texture(concrete, positionWorld.xz.mul(0.12)).r.mul(0.4).add(0.75),
  );
  deck.normalNode = bumpMap(
    texture(concrete, positionWorld.xz.mul(0.5)).b,
    0.4,
  );
  const galvanized = tubeMaterial({
    color: "#87909f",
    roughness: 0.42,
    metalness: 0.7,
  });
  const metalGrain = triplanarTexture(
    texture(grain),
    null,
    null,
    1.4,
    positionWorld,
    normalWorld,
  );
  galvanized.colorNode = color("#87909f").mul(
    metalGrain.r.mul(0.35).add(0.825),
  );
  galvanized.roughnessNode = metalGrain.r.mul(0.24).add(0.3);
  galvanized.normalNode = bumpMap(metalGrain.r, 0.06);
  const insulation = tubeMaterial({
    color: "#9b9ca2",
    roughness: 0.66,
    metalness: 0.2,
  });
  const wrapping = triplanarTexture(
    texture(concrete),
    null,
    null,
    0.35,
    positionWorld,
    normalWorld,
  );
  insulation.colorNode = color("#9b9ca2").mul(wrapping.r.mul(0.3).add(0.8));
  insulation.normalNode = bumpMap(wrapping.b, 0.24);
  const dark = tubeMaterial({
    color: "#0b0d13",
    roughness: 0.78,
    metalness: 0.1,
  });
  const ceilingMaterials = new Set([steel, deck, galvanized, insulation, dark]);
  function add(geometry, material, position, destination = group) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(position);
    destination.add(mesh);
    return mesh;
  }
  function box(size, position, material = steel) {
    return add(new THREE.BoxGeometry(...size), material, position);
  }
  const span = ENVIRONMENT_HALF_SIZE * 2;
  box([span, 0.16, span], [0, FLOOR_Y - 0.08, 0], floor);
  box([span, 0.2, span], [0, CEILING_Y + 0.1, 0], deck);
  // Four concrete piers with softened edges, plinths, and steel capitals.
  for (const [x, z] of COLUMN_LOCATIONS) {
    const top = CEILING_Y - 0.12,
      base = FLOOR_Y + 0.25;
    for (const [size, position] of [
      [
        [COLUMN_BASE_WIDTH, 0.25, COLUMN_BASE_WIDTH],
        [x, FLOOR_Y + 0.125, z],
      ],
      [
        [COLUMN_SHAFT_WIDTH, top - base, COLUMN_SHAFT_WIDTH],
        [x, (base + top) / 2, z],
      ],
    ]) {
      add(new RoundedBoxGeometry(...size, 2, 0.035), column, position);
    }
    box([0.92, 0.12, 0.92], [x, CEILING_Y - 0.06, z], steel);
  }
  box([0.18, 12, 26], [-ROOM_HALF_WIDTH, 3, 4], wall);
  box([0.18, 12, 26], [ROOM_HALF_WIDTH, 3, 4], wall);
  const ceilingParts = new THREE.Group();
  buildCeiling(
    (geometry, material, position) =>
      add(geometry, material, position, ceilingParts),
    { concrete: deck, steel, galvanized, insulation, dark },
    { includeDeck: false },
  );
  const combined = [
    ...batchMeshes(group),
    ...batchMeshes(ceilingParts, CEILING_BAY_OFFSETS),
  ];
  for (const mesh of combined) {
    mesh.castShadow =
      ceilingMaterials.has(mesh.material) || mesh.material === column;
    mesh.receiveShadow = ceilingMaterials.has(mesh.material);
    group.add(mesh);
  }
  const ambient = new THREE.HemisphereLight("#a8b0c3", "#252a38", 0.055);
  scene.add(ambient);
  const ceilingLights = createCeilingLights(scene, settings);
  return {
    group,
    floor,
    column,
    roughness,
    concrete,
    ceilingLights,
    columnShadows,
    setLights(emitters) {
      const lighting = lights([...emitters, ambient]);
      for (const material of [floor, wall, column])
        material.lightsNode = lighting;
      const overhead = lights([...ceilingLights.lights, ambient]);
      for (const material of ceilingMaterials) material.lightsNode = overhead;
      ceilingLights.setEmitters(emitters);
    },
    update(travel = 0) {
      roughness.value = settings.floorRoughness;
      roughnessMax.value = settings.floorRoughnessMax;
      textureLow.value = settings.floorTextureLow;
      textureHigh.value = settings.floorTextureHigh;
      ceilingLights.update(travel);
      columnShadows.update();
    },
    dispose() {
      ceilingLights.dispose();
      for (const mesh of group.children) {
        if (mesh.isInstancedMesh) mesh.dispose();
        mesh.geometry.dispose();
      }
      [floor, wall, steel, column, deck, galvanized, insulation, dark].forEach(
        (material) => material.dispose(),
      );
      grain.dispose();
      concrete.dispose();
      group.removeFromParent();
      ambient.removeFromParent();
    },
  };
}
