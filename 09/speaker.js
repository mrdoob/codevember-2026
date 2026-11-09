import * as THREE from "three/webgpu";
import {
  attribute,
  bumpMap,
  cameraWorldMatrix,
  cameraViewMatrix,
  cameraProjectionMatrix,
  color,
  instanceIndex,
  mix,
  positionLocal,
  storage,
  texture,
  transformNormalToView,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
  vertexIndex,
} from "three/tsl";
import { GRID } from "./simulation.js";
import { RADIUS } from "./modes.js";
import {
  createFinishTexture,
  createPorousTexture,
} from "./surface-textures.js";

function lathe(profile, material, segments = 384) {
  const area = profile.reduce((a, p, i) => {
    const q = profile[(i + 1) % profile.length];
    return a + p[0] * q[1] - q[0] * p[1];
  }, 0);
  if (area < 0) profile = [...profile].reverse();
  const geometry = new THREE.LatheGeometry(
    profile.map((p) => new THREE.Vector2(...p)),
    segments,
  );
  // Analytic circumferential tangents avoid a separate anisotropic highlight
  // for every triangle when the flange is viewed at a grazing angle.
  const p = geometry.attributes.position,
    tangents = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const radius = Math.hypot(p.getX(i), p.getZ(i));
    tangents[i * 4] = radius > 0 ? p.getZ(i) / radius : 1;
    tangents[i * 4 + 2] = radius > 0 ? -p.getX(i) / radius : 0;
    tangents[i * 4 + 3] = 1;
  }
  geometry.setAttribute("tangent", new THREE.BufferAttribute(tangents, 4));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function torus(radius, tube, height, material, radial = 12) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, radial, 256),
    material,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = height;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function instances(
  name,
  geometry,
  material,
  count,
  place,
  castShadow = false,
  receiveShadow = false,
) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  const transform = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    transform.position.set(0, 0, 0);
    transform.quaternion.identity();
    transform.scale.set(1, 1, 1);
    place(transform, i);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

export function createSpeaker(simulation) {
  const group = new THREE.Group();
  const grainMap = createFinishTexture(true);
  const brushUV = vec2(uv().x, positionLocal.xz.length().mul(0.75));
  const grain = texture(grainMap, brushUV).r;
  const metal = new THREE.MeshPhysicalNodeMaterial({
    color: "#77858b",
    metalness: 1,
    roughness: 0.32,
    anisotropy: 0.35,
  });
  metal.colorNode = color("#77858b").mul(mix(0.92, 1.06, grain));
  metal.roughnessNode = grain.mul(0.1).add(0.27);
  metal.normalNode = bumpMap(grain, 0.015);
  const edge = new THREE.MeshStandardNodeMaterial({
    color: "#a6b4b7",
    metalness: 1,
    roughness: 0.18,
  });
  const black = new THREE.MeshPhysicalNodeMaterial({
    color: "#283033",
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 0.25,
  });
  const rubber = new THREE.MeshStandardNodeMaterial({
    color: "#080d0e",
    roughness: 0.68,
  });
  const copper = new THREE.MeshStandardNodeMaterial({
    color: "#ad6541",
    metalness: 1,
    roughness: 0.3,
  });
  const recess = new THREE.MeshStandardNodeMaterial({
    color: "#020405",
    metalness: 0.15,
    roughness: 0.6,
  });

  // A rolled silicone suspension, beveled mounting flange, open cast basket,
  // copper voice coil and magnet. The vibrating face remains an unbroken foil.
  group.add(
    lathe(
      [
        [3.1, 0.16],
        [3.1, 0.27],
        [3.13, 0.3],
        [3.16, 0.3],
        [3.38, 0.3],
        [3.41, 0.3],
        [3.45, 0.26],
        [3.45, 0.06],
        [3.41, 0.02],
        [3.14, 0.02],
        [3.1, 0.16],
      ],
      metal,
    ),
  );
  group.add(
    lathe(
      [
        [2.94, 0.19],
        [2.98, 0.24],
        [3.015, 0.285],
        [3.05, 0.295],
        [3.09, 0.27],
        [3.12, 0.21],
      ],
      rubber,
    ),
  );
  group.add(torus(2.97, 0.016, 0.223, black));
  group.add(
    lathe(
      [
        [3.4, 0.03],
        [3.4, -0.12],
        [3.36, -0.16],
        [3.14, -0.16],
        [3.14, 0.03],
      ],
      black,
    ),
  );

  const screwGeometry = new THREE.CylinderGeometry(0.065, 0.08, 0.025, 32);
  const recessGeometry = new THREE.CylinderGeometry(0.086, 0.086, 0.009, 32);
  const socketGeometry = new THREE.CylinderGeometry(0.034, 0.034, 0.004, 6);
  const washerGeometry = new THREE.TorusGeometry(0.077, 0.006, 6, 32);
  const placeFastener = (part, i, height) => {
    const a = ((i + 0.5) / 12) * Math.PI * 2,
      x = Math.sin(a) * 3.285,
      z = Math.cos(a) * 3.285;
    part.position.set(x, height, z);
    return a;
  };
  group.add(
    instances("Screw recesses", recessGeometry, recess, 12, (part, i) =>
      placeFastener(part, i, 0.306),
    ),
    instances(
      "Screws",
      screwGeometry,
      edge,
      12,
      (part, i) => placeFastener(part, i, 0.308),
      true,
    ),
    instances("Hex sockets", socketGeometry, recess, 12, (part, i) => {
      part.rotation.y = placeFastener(part, i, 0.322);
    }),
    instances("Washers", washerGeometry, edge, 12, (part, i) => {
      placeFastener(part, i, 0.309);
      part.rotation.x = -Math.PI / 2;
    }),
  );
  const chassis = new THREE.Group();
  chassis.scale.y = 0.48;
  group.add(chassis);
  // Twelve ribs leave real openings into the underside of the driver.
  const ribGeometry = new THREE.BoxGeometry(0.21, 1, 0.15);
  chassis.add(
    instances(
      "Basket ribs",
      ribGeometry,
      black,
      12,
      (rib, i) => {
        const a = (i / 12) * Math.PI * 2;
        const top = new THREE.Vector3(
          Math.cos(a) * 3.35,
          -0.1,
          Math.sin(a) * 3.35,
        );
        const bottom = new THREE.Vector3(
          Math.cos(a) * 1.83,
          -1.18,
          Math.sin(a) * 1.83,
        );
        rib.position.copy(top).add(bottom).multiplyScalar(0.5);
        rib.scale.y = top.distanceTo(bottom);
        rib.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          top.sub(bottom).normalize(),
        );
      },
      true,
      true,
    ),
  );
  chassis.add(
    lathe(
      [
        [1.7, -1.2],
        [1.88, -1.2],
        [1.9, -1.13],
        [1.9, -0.99],
        [1.85, -0.95],
        [1.7, -0.95],
      ],
      black,
    ),
  );
  chassis.add(
    lathe(
      [
        [0, -1.43],
        [1.72, -1.43],
        [1.78, -1.38],
        [1.78, -1.2],
        [1.72, -1.15],
        [0, -1.15],
      ],
      metal,
    ),
  );
  chassis.add(torus(1.75, 0.026, -1.38, edge));
  chassis.add(
    lathe(
      [
        [1.38, -1.05],
        [1.38, -0.4],
        [1.42, -0.4],
        [1.42, -1.05],
      ],
      copper,
    ),
  );
  const wireGeometry = new THREE.TorusGeometry(1.43, 0.015, 6, 192);
  chassis.add(
    instances("Coil turns", wireGeometry, copper, 18, (wire, i) => {
      wire.rotation.x = -Math.PI / 2;
      wire.position.y = -0.96 + i * 0.029;
    }),
  );
  const rubberFootGeometry = new THREE.CylinderGeometry(0.22, 0.25, 0.16, 32);
  chassis.add(
    instances(
      "Rubber feet",
      rubberFootGeometry,
      rubber,
      3,
      (foot, i) => {
        const a = (i / 3) * Math.PI * 2;
        foot.position.set(Math.sin(a) * 1.3, -1.5, Math.cos(a) * 1.3);
      },
      true,
      true,
    ),
  );
  // Thin flared supports curve into broad feet; smooth surfaces catch the
  // amber edge light without the block-like end caps of an extruded bracket.
  const supportPositions = [],
    supportIndices = [],
    across = 20,
    down = 20;
  for (let layer = 0; layer < 2; layer++)
    for (let j = 0; j <= down; j++)
      for (let i = 0; i <= across; i++) {
        const v = j / down,
          u = (i / across) * 2 - 1;
        const width = 0.11 + 0.21 * v + 0.04 * Math.sin(v * Math.PI);
        const angle = u * width;
        const radius =
          3.3 -
          0.3 * Math.sin(v * Math.PI * 0.5) +
          0.14 * v ** 8 +
          (layer === 0 ? 0.025 : -0.025);
        const y = -0.12 - 1.45 * v + 0.02 * u * u;
        supportPositions.push(
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius,
        );
      }
  const row = across + 1,
    layerSize = row * (down + 1);
  for (let layer = 0; layer < 2; layer++)
    for (let j = 0; j < down; j++)
      for (let i = 0; i < across; i++) {
        const k = layer * layerSize + j * row + i;
        if (layer === 0)
          supportIndices.push(k, k + 1, k + row, k + 1, k + row + 1, k + row);
        else
          supportIndices.push(k, k + row, k + 1, k + 1, k + row, k + row + 1);
      }
  const bridge = (a, b) =>
    supportIndices.push(a, b, a + layerSize, b, b + layerSize, a + layerSize);
  for (let j = 0; j < down; j++) {
    bridge(j * row, (j + 1) * row);
    bridge((j + 1) * row + across, j * row + across);
  }
  for (let i = 0; i < across; i++) {
    bridge(i + 1, i);
    bridge(down * row + i, down * row + i + 1);
  }
  const supportGeometry = new THREE.BufferGeometry();
  supportGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(supportPositions, 3),
  );
  supportGeometry.setIndex(supportIndices);
  supportGeometry.computeVertexNormals();
  const supportMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#343b3d",
    metalness: 0.75,
    roughness: 0.28,
    side: THREE.DoubleSide,
  });
  chassis.add(
    instances(
      "Curved supports",
      supportGeometry,
      supportMaterial,
      6,
      (foot, i) => {
        foot.rotation.y = (i / 6) * Math.PI * 2;
      },
      true,
      true,
    ),
  );
  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.9, -0.13, -0.8),
    new THREE.Vector3(-3.55, -0.1, -0.7),
    new THREE.Vector3(-4.1, -0.28, -0.8),
    new THREE.Vector3(-4.6, -0.68, -1.0),
    // Rest on the studio floor: -.7584 + the cable's .058 radius.
    new THREE.Vector3(-4.85, -0.7004, -1.1),
    new THREE.Vector3(-5.05, -0.7004, -1.4),
    new THREE.Vector3(-5.7, -0.7004, -2.7),
    new THREE.Vector3(-8, -0.7004, -4.8),
  ]);
  const braid = new THREE.MeshStandardNodeMaterial({
    color: "#101a1e",
    roughness: 0.64,
    metalness: 0.15,
  });
  const strands = uv()
    .x.mul(650)
    .add(uv().y.mul(16))
    .mul(Math.PI * 2)
    .sin()
    .mul(
      uv()
        .x.mul(650)
        .sub(uv().y.mul(16))
        .mul(Math.PI * 2)
        .sin(),
    );
  braid.colorNode = color("#26363b").mul(strands.mul(0.25).add(0.6));
  braid.roughnessNode = strands.mul(0.1).add(0.6);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(cableCurve, 180, 0.058, 12, false),
    braid,
  );
  cable.castShadow = true;
  group.add(cable);

  const positions = new Float32Array(GRID * GRID * 3),
    normals = new Float32Array(GRID * GRID * 3),
    uvs = new Float32Array(GRID * GRID * 2),
    indices = [];
  const cell = (RADIUS * 2) / (GRID - 1);
  for (let z = 0; z < GRID; z++)
    for (let x = 0; x < GRID; x++) {
      const k = z * GRID + x;
      positions[k * 3] = x * cell - RADIUS;
      positions[k * 3 + 1] = simulation.height[k];
      positions[k * 3 + 2] = z * cell - RADIUS;
      normals[k * 3 + 1] = 1;
      uvs[k * 2] = x / (GRID - 1);
      uvs[k * 2 + 1] = z / (GRID - 1);
      if (x < GRID - 1 && z < GRID - 1) {
        const farX = Math.max(
          Math.abs(x * cell - RADIUS),
          Math.abs((x + 1) * cell - RADIUS),
        );
        const farZ = Math.max(
          Math.abs(z * cell - RADIUS),
          Math.abs((z + 1) * cell - RADIUS),
        );
        if (Math.hypot(farX, farZ) <= RADIUS)
          indices.push(k, k + GRID, k + 1, k + 1, k + GRID, k + GRID + 1);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3.3);
  const foil = new THREE.MeshPhysicalNodeMaterial({
    color: "#101617",
    metalness: 0,
    roughness: 0.88,
    clearcoat: 0,
    iridescence: 0,
    side: THREE.DoubleSide,
  });
  const porousMap = createPorousTexture(),
    pores = texture(porousMap, uv().mul(3)).r;
  const foilRoughness = uniform(0.88),
    foilBump = uniform(2);
  foil.colorNode = color("#101617").mul(mix(0.96, 1.04, pores));
  foil.roughnessNode = foilRoughness
    .add(pores.sub(0.5).mul(0.04))
    .clamp(0.45, 1);
  foil.normalNode = bumpMap(pores, foilBump);
  const membrane = new THREE.Mesh(geometry, foil);
  membrane.castShadow = membrane.receiveShadow = true;
  group.add(membrane);

  // Two triangles per grain. Fragment normals and depth describe a sphere;
  // the same billboarding and disk mask are also used by the shadow camera.
  const sourceGrain = new THREE.PlaneGeometry(2, 2);
  const grainGeometry = new THREE.InstancedBufferGeometry();
  grainGeometry.index = sourceGrain.index;
  grainGeometry.attributes.position = sourceGrain.attributes.position;
  grainGeometry.attributes.normal = sourceGrain.attributes.normal;
  grainGeometry.attributes.uv = sourceGrain.attributes.uv;
  let grainPositions;
  const sandMaterial = new THREE.MeshPhysicalNodeMaterial({
    metalness: 0,
    roughness: 0.72,
    clearcoat: 0,
  });
  const particleVisibility = uniform(1);
  // PCF shadows normally render back faces of closed meshes. A billboard has
  // no back shell: render its light-facing front and use the spherical depth.
  sandMaterial.shadowSide = THREE.FrontSide;
  const seed = attribute("grainSeed", "float");
  sandMaterial.colorNode = mix(
    color("#d8d9d4"),
    color("#ffffff"),
    seed.div(Math.PI * 2),
  );
  const sand = new THREE.Mesh(grainGeometry, sandMaterial);
  sand.frustumCulled = false;
  sand.castShadow = sand.receiveShadow = true;
  group.add(sand);

  function setSimulation(next) {
    simulation = next;
    for (const name of ["grainPosition", "grainSize", "grainSeed"])
      grainGeometry.getAttribute(name)?.dispose();
    grainPositions = new THREE.InstancedBufferAttribute(
      simulation.positions,
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    grainGeometry.setAttribute("grainPosition", grainPositions);
    grainGeometry.setAttribute(
      "grainSize",
      new THREE.InstancedBufferAttribute(simulation.sizes, 1),
    );
    grainGeometry.setAttribute(
      "grainSeed",
      new THREE.InstancedBufferAttribute(simulation.seeds, 1),
    );
    grainGeometry.instanceCount = simulation.grainCount;
    if (simulation.gpu) {
      const surface = storage(
        simulation.gpu.surfaceAttribute,
        "vec4",
        GRID * GRID,
      ).element(vertexIndex);
      foil.positionNode = vec3(positionLocal.x, surface.x, positionLocal.z);
      const surfaceNormal = transformNormalToView(
        varying(surface.yzw, "surfaceNormal"),
      );
      foil.normalNode = bumpMap(pores, foilBump, surfaceNormal);
      foil.smoothShadowNormalNode =
        surfaceNormal.transformDirection(cameraWorldMatrix);
    }
    const data = simulation.gpu
      ? storage(
          simulation.gpu.drawAttribute,
          "vec4",
          simulation.grainCount,
        ).element(instanceIndex)
      : vec4(
          attribute("grainPosition", "vec3"),
          attribute("grainSize", "float"),
        );
    // Stagger the reveal slightly per grain. Scaling the analytic sphere
    // eases both its coverage and shadow without transparent sorting.
    const reveal = particleVisibility
      .sub(seed.div(Math.PI * 2).mul(0.2))
      .div(0.8)
      .smoothstep(0, 1);
    const radius = data.w.mul(reveal);
    const sphere = varying(vec4(data.xyz, radius), "sphereData");
    const billboard = cameraWorldMatrix.mul(
      vec4(positionLocal.xy.mul(radius), 0, 0),
    ).xyz;
    sandMaterial.positionNode = data.xyz.add(billboard);
    const xy = uv().mul(2).sub(1),
      radiusSquared = xy.dot(xy);
    const sphereNormal = vec3(xy, radiusSquared.oneMinus().max(0).sqrt());
    sandMaterial.normalNode = sphereNormal;
    sandMaterial.maskNode = radiusSquared.lessThanEqual(1);
    sandMaterial.smoothShadowNormalNode =
      sphereNormal.transformDirection(cameraWorldMatrix);
    const centerView = cameraViewMatrix.mul(vec4(sphere.xyz, 1));
    const sphereView = centerView.add(vec4(sphereNormal.mul(sphere.w), 0));
    const projected = cameraProjectionMatrix.mul(sphereView);
    sandMaterial.depthNode = projected.z.div(projected.w);
    foil.needsUpdate = true;
    sandMaterial.needsUpdate = true;
  }
  setSimulation(simulation);

  function update(settings, visibility = settings?.grains === false ? 0 : 1) {
    if (!simulation.gpu) {
      const h = simulation.height;
      for (let k = 0; k < h.length; k++) {
        positions[k * 3 + 1] = h[k];
        if (
          k % GRID === 0 ||
          k % GRID === GRID - 1 ||
          k < GRID ||
          k >= h.length - GRID
        )
          continue;
        const nx = -(h[k + 1] - h[k - 1]) / (2 * cell),
          nz = -(h[k + GRID] - h[k - GRID]) / (2 * cell);
        const inv = 1 / Math.hypot(nx, 1, nz);
        normals[k * 3] = nx * inv;
        normals[k * 3 + 1] = inv;
        normals[k * 3 + 2] = nz * inv;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.normal.needsUpdate = true;
      grainPositions.needsUpdate = true;
    }
    if (settings) {
      foilRoughness.value = settings.roughness;
    }
    particleVisibility.value = visibility;
    sand.visible = visibility > 0.001;
  }
  update();
  return {
    group,
    membrane,
    sand,
    foil,
    particleVisibility,
    update,
    setSimulation,
    dispose() {
      const geometries = new Set(),
        materials = new Set();
      group.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        if (o.geometry) geometries.add(o.geometry);
        if (o.material) materials.add(o.material);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      grainMap.dispose();
      porousMap.dispose();
    },
  };
}
