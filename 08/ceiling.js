import * as THREE from "three/webgpu";
import {
  CEILING_Y,
  ROOM_BACK_Z,
  CEILING_BAY_WIDTH,
  CEILING_BAY_DEPTH,
} from "./room-layout.js";

// Exposed services below a flat concrete deck. All hanging parts stay above
// CEILING_Y - CEILING_FIXTURE_DEPTH, the same boundary used by the sculpture.
export function buildCeiling(add, materials, { includeDeck = true } = {}) {
  const { concrete, steel, galvanized, insulation, dark } = materials;
  const width = CEILING_BAY_WIDTH,
    depth = CEILING_BAY_DEPTH,
    centerZ = ROOM_BACK_Z + depth / 2;
  function box(size, position, material = steel) {
    return add(new THREE.BoxGeometry(...size), material, position);
  }
  const up = new THREE.Vector3(0, 1, 0);
  function pipe(
    start,
    end,
    radius,
    material = galvanized,
    wrapped = false,
    open = false,
  ) {
    const a = new THREE.Vector3(...start),
      b = new THREE.Vector3(...end),
      direction = b.clone().sub(a),
      length = direction.length();
    const geometry = new THREE.CylinderGeometry(
      radius,
      radius,
      length,
      wrapped ? 20 : 12,
      wrapped ? Math.ceil(length / 0.16) : 1,
      open,
    );
    if (wrapped) {
      const p = geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const angle = Math.atan2(p.getZ(i), p.getX(i)),
          y = p.getY(i);
        const ripple =
          1 +
          0.018 * Math.sin(y * 27 + angle * 2) +
          0.012 * Math.sin(y * 49 - angle * 3);
        p.setX(i, p.getX(i) * ripple);
        p.setZ(i, p.getZ(i) * ripple);
      }
      geometry.computeVertexNormals();
    }
    const mesh = add(
      geometry,
      material,
      a.add(b).multiplyScalar(0.5).toArray(),
    );
    mesh.quaternion.setFromUnitVectors(up, direction.divideScalar(length));
    return mesh;
  }
  function bolt(position, axis = [0, -1, 0], radius = 0.018) {
    const mesh = add(
      new THREE.CylinderGeometry(radius, radius, 0.018, 6),
      galvanized,
      position,
    );
    mesh.quaternion.setFromUnitVectors(up, new THREE.Vector3(...axis));
  }
  function ring(position, axis, radius, tube = 0.012, material = galvanized) {
    const mesh = add(
      new THREE.TorusGeometry(radius, tube, 6, 24),
      material,
      position,
    );
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(...axis),
    );
  }
  function cable(points, radius = 0.012) {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
    );
    return add(
      new THREE.TubeGeometry(curve, 20, radius, 6, false),
      dark,
      [0, 0, 0],
    );
  }
  const deck = CEILING_Y;
  if (includeDeck) box([width, 0.2, depth], [0, deck + 0.1, centerZ], concrete);
  // Formwork joints and tie marks remain flush with the flat concrete soffit.
  for (const x of [-6, -2, 2, 6])
    box([0.012, 0.004, depth], [x, deck - 0.002, centerZ], dark);
  for (const z of [-6, 0, 6, 12])
    box([width, 0.004, 0.012], [0, deck - 0.002, z], dark);
  // Deep I-beams, with separate webs and flanges.
  for (const x of [-8, -4, 0, 4, 8]) {
    box([0.11, 0.36, depth], [x, deck - 0.18, centerZ]);
    for (const y of [deck - 0.04, deck - 0.37])
      box([0.4, 0.055, depth], [x, y, centerZ]);
  }
  for (const z of [-7.6, -3.7, 0.2, 4.1, 8, 11.9, 15.8]) {
    box([width, 0.29, 0.1], [0, deck - 0.2, z]);
    box([width, 0.045, 0.31], [0, deck - 0.365, z]);
    for (const x of [-8, -4, 0, 4, 8]) {
      // Web stiffeners and bolted lower splice plates at each beam junction.
      for (const side of [-1, 1])
        box([0.15, 0.27, 0.025], [x + side * 0.12, deck - 0.19, z]);
      box([0.36, 0.025, 0.48], [x, deck - 0.411, z]);
      for (const dx of [-0.12, 0.12])
        for (const dz of [-0.16, 0.16]) bolt([x + dx, deck - 0.435, z + dz]);
    }
  }
  // Large wrapped ducts with metal bands, and smaller longitudinal branches.
  const ductY = deck - 0.74;
  for (const z of [-5.4, -1, 3.4, 7.8, 12.2]) {
    pipe([-width / 2, ductY, z], [width / 2, ductY, z], 0.25, insulation, true);
    for (let x = -8.5; x < 9; x += 1.35)
      pipe([x - 0.022, ductY, z], [x + 0.022, ductY, z], 0.258, galvanized);
    for (const x of [-7, -2.2, 2.6, 7.4]) {
      for (const side of [-1, 1])
        pipe(
          [x, deck - 0.15, z + side * 0.3],
          [x, ductY - 0.29, z + side * 0.3],
          0.012,
          steel,
        );
      box([0.055, 0.045, 0.68], [x, ductY - 0.29, z], galvanized);
    }
  }
  for (const x of [-4.5, 2.8]) {
    pipe(
      [x, deck - 0.69, ROOM_BACK_Z],
      [x, deck - 0.69, ROOM_BACK_Z + depth],
      0.19,
      insulation,
      true,
    );
    for (let z = -7.8; z < 16; z += 1.5)
      pipe(
        [x, deck - 0.69, z - 0.022],
        [x, deck - 0.69, z + 0.022],
        0.199,
        galvanized,
      );
  }
  // Sheet-metal supply trunks: flanged sections, access panels and hangers.
  for (const x of [-6.2, 6.2]) {
    const y = deck - 0.63;
    box([0.76, 0.32, depth], [x, y, centerZ], galvanized);
    for (let z = -8; z < 16; z += 1.65) {
      for (const side of [-1, 1]) {
        box([0.045, 0.39, 0.045], [x + side * 0.4, y, z], steel);
        box([0.84, 0.035, 0.045], [x, y + side * 0.185, z], galvanized);
        for (const dy of [-0.13, 0.13])
          bolt([x + side * 0.4, y + dy, z + 0.035], [0, 0, 1]);
      }
    }
    for (const z of [-6.5, -2, 2.5, 7, 11.5]) {
      box([0.5, 0.018, 0.56], [x, y - 0.17, z], steel);
      for (const dx of [-0.21, 0.21])
        for (const dz of [-0.23, 0.23])
          bolt([x + dx, y - 0.19, z + dz], undefined, 0.012);
      for (const side of [-1, 1]) {
        pipe(
          [x + side * 0.49, deck - 0.12, z + 0.48],
          [x + side * 0.49, y - 0.23, z + 0.48],
          0.012,
          steel,
        );
        bolt([x + side * 0.49, y - 0.255, z + 0.48]);
      }
      box([1.08, 0.035, 0.075], [x, y - 0.235, z + 0.48], galvanized);
    }
    // Downward-facing diffuser boxes with inset throats and angled louvers.
    for (const z of [-3, 5.8, 13]) {
      box([0.56, 0.18, 0.62], [x, deck - 0.87, z], galvanized);
      box([0.68, 0.025, 0.74], [x, deck - 0.973, z], dark);
      for (const side of [-1, 1]) {
        box(
          [0.055, 0.065, 0.85],
          [x + side * 0.38, deck - 0.99, z],
          galvanized,
        );
        box([0.81, 0.065, 0.055], [x, deck - 0.99, z + side * 0.4], galvanized);
      }
      for (let i = -3; i <= 3; i++) {
        const louver = box(
          [0.69, 0.014, 0.07],
          [x, deck - 0.999, z + i * 0.1],
          galvanized,
        );
        louver.rotation.x = 0.38;
      }
    }
  }
  // Open branch mouths: inset dark interiors, with rolled rims.
  for (const [x, z] of [
    [-3.1, -5.4],
    [4.7, -1],
    [-1.5, 3.4],
    [5.3, 7.8],
  ]) {
    const end = z + 0.75;
    pipe([x, ductY, z], [x, ductY, end], 0.17, insulation, false, true);
    add(new THREE.CircleGeometry(0.164, 20), dark, [x, ductY, end - 0.07]);
    add(new THREE.TorusGeometry(0.17, 0.018, 6, 20), galvanized, [
      x,
      ductY,
      end,
    ]);
    ring([x, ductY, end], [0, 0, 1], 0.205);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      bolt(
        [x + Math.cos(a) * 0.205, ductY + Math.sin(a) * 0.205, end + 0.012],
        [0, 0, 1],
        0.012,
      );
    }
    for (const dy of [-0.1, 0, 0.1])
      box(
        [Math.sqrt(0.16 ** 2 - dy ** 2) * 2, 0.018, 0.025],
        [x, ductY + dy, end - 0.012],
        galvanized,
      );
  }
  // A low suspended grid of narrow double rails, supported by steel rods.
  const gridY = deck - 1.04;
  const gridX = [-8, -5.4, -2.8, -0.2, 2.4, 5, 7.6];
  const gridZ = [-7.8, -5.2, -2.6, 0, 2.6, 5.2, 7.8, 10.4, 13];
  for (const x of gridX)
    for (const side of [-1, 1])
      box(
        [0.025, 0.045, depth],
        [x + side * 0.045, gridY, centerZ],
        galvanized,
      );
  for (const z of gridZ)
    for (const side of [-1, 1])
      box(
        [width, 0.045, 0.025],
        [0, gridY - 0.025, z + side * 0.045],
        galvanized,
      );
  for (let i = 0; i < gridX.length; i++)
    for (let j = 0; j < gridZ.length; j++)
      if ((i + j) % 2 === 0) {
        const x = gridX[i],
          z = gridZ[j];
        pipe([x, deck - 0.12, z], [x, gridY + 0.02, z], 0.012, steel);
        box([0.16, 0.035, 0.16], [x, gridY + 0.035, z], steel);
      }
  // Ladder trays, dark cable bundles, and thin service pipes above the grid.
  for (const x of [-1.1, 5.8]) {
    for (const side of [-1, 1])
      box(
        [0.03, 0.085, depth],
        [x + side * 0.22, gridY + 0.13, centerZ],
        steel,
      );
    for (let z = -8.2; z < 16; z += 0.37)
      box([0.45, 0.025, 0.026], [x, gridY + 0.1, z], galvanized);
    for (let cable = 0; cable < 4; cable++)
      pipe(
        [x - 0.13 + cable * 0.085, gridY + 0.15, ROOM_BACK_Z],
        [x - 0.13 + cable * 0.085, gridY + 0.15, ROOM_BACK_Z + depth],
        0.018,
        dark,
      );
  }
  for (const z of [-4, 4.8, 11]) {
    // Cross trays branch from the main cable runs into bolted junction boxes.
    for (const side of [-1, 1])
      box([6.9, 0.075, 0.03], [2.35, gridY + 0.13, z + side * 0.22], steel);
    for (let x = -1.05; x < 5.8; x += 0.37)
      box([0.026, 0.025, 0.45], [x, gridY + 0.1, z], galvanized);
    for (let i = 0; i < 4; i++) {
      const dz = (i - 1.5) * 0.07;
      cable([
        [-1.1 + dz, gridY + 0.19, z - 1],
        [-1.1 + dz, gridY + 0.19, z - 0.25],
        [-0.8, gridY + 0.19, z + dz],
        [5.45, gridY + 0.19, z + dz],
        [5.8 + dz, gridY + 0.19, z + 0.25],
        [5.8 + dz, gridY + 0.19, z + 1],
      ]);
    }
    for (const x of [-1.75, 6.45]) {
      box([0.36, 0.18, 0.46], [x, gridY + 0.2, z], galvanized);
      box([0.32, 0.025, 0.42], [x, gridY + 0.095, z], steel);
      for (const dx of [-0.12, 0.12])
        for (const dz of [-0.17, 0.17])
          bolt([x + dx, gridY + 0.075, z + dz], undefined, 0.012);
      const direction = x < 0 ? 1 : -1;
      for (let i = 0; i < 3; i++)
        cable([
          [x, gridY + 0.19, z + (i - 1) * 0.075],
          [x + direction * 0.3, gridY + 0.12, z + (i - 1) * 0.075],
          [x + direction * 0.65, gridY + 0.2, z + (i - 1) * 0.075],
        ]);
    }
  }
  for (const z of [-6.8, -2.4, 2, 6.4, 10.8]) {
    const y = deck - 0.98;
    pipe([-width / 2, y, z], [width / 2, y, z], 0.032, galvanized);
    for (let x = -8.8; x < 9; x += 1.5)
      pipe([x - 0.035, y, z], [x + 0.035, y, z], 0.048, steel);
    for (const x of [-7.3, 3.9]) {
      pipe([x - 0.11, y, z], [x + 0.11, y, z], 0.064, steel);
      for (const side of [-1, 1])
        ring([x + side * 0.1, y, z], [1, 0, 0], 0.069, 0.008);
      pipe([x, y, z], [x, y + 0.14, z], 0.018, galvanized);
      ring([x, y + 0.14, z], [0, 1, 0], 0.1, 0.012, steel);
      for (const a of [0, Math.PI / 3, (Math.PI * 2) / 3])
        pipe(
          [x - Math.cos(a) * 0.09, y + 0.14, z - Math.sin(a) * 0.09],
          [x + Math.cos(a) * 0.09, y + 0.14, z + Math.sin(a) * 0.09],
          0.007,
          steel,
        );
    }
    for (const x of [-6.5, -1.5, 3.5, 8.5]) {
      pipe([x, y, z], [x, gridY - 0.055, z], 0.018, galvanized);
      box([0.075, 0.025, 0.075], [x, gridY - 0.065, z], galvanized);
    }
  }
}
