import * as THREE from "three/webgpu";
import { color, mix, uv } from "three/tsl";

// A real, enclosed reflection set. Geometry and lights exist only for the bake.
export function createStudioRoom() {
  const room = new THREE.Scene();
  room.name = "Membrane photographic studio";
  room.background = new THREE.Color("#07090c");
  const wall = new THREE.MeshLambertNodeMaterial({
    color: "#838b91",
    side: THREE.DoubleSide,
  });
  const ceiling = new THREE.MeshLambertNodeMaterial({ color: "#515b63" });
  const dark = new THREE.MeshLambertNodeMaterial({ color: "#111519" });
  const black = new THREE.MeshBasicNodeMaterial({ color: "#020304" });
  const bounce = new THREE.MeshLambertNodeMaterial({
    color: "#b4babd",
    side: THREE.DoubleSide,
  });
  const boxGeometry = new THREE.BoxGeometry();
  function box(name, p, size, material = dark, parent = room) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.name = name;
    mesh.position.fromArray(p);
    mesh.scale.fromArray(size);
    parent.add(mesh);
    return mesh;
  }

  // Seamless floor-to-wall sweep, with a three-unit curved cove at the back.
  const profile = [
    [-13, -4],
    [9, -4],
  ];
  for (let i = 1; i <= 24; i++) {
    const angle = ((i / 24) * Math.PI) / 2;
    profile.push([9 + 3 * Math.sin(angle), -1 - 3 * Math.cos(angle)]);
  }
  profile.push([12, 12]);
  const positions = [],
    indices = [];
  profile.forEach(([z, y], i) => {
    positions.push(-12, y, z, 12, y, z);
    if (i) {
      const k = i * 2;
      indices.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const sweep = new THREE.BufferGeometry();
  sweep.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  sweep.setIndex(indices);
  sweep.computeVertexNormals();
  const cyclorama = new THREE.Mesh(sweep, wall);
  cyclorama.name = "Curved cyclorama";
  room.add(cyclorama);
  box("Left wall", [-12, 4, 0], [0.2, 16, 26], wall);
  box("Right wall", [12, 4, 0], [0.2, 16, 26], wall);
  box("Front wall", [0, 4, -13], [24, 16, 0.2], dark);
  box("Ceiling", [0, 12, 0], [24, 0.2, 26], ceiling);

  // Opaque diffusion panels with a gradual falloff toward their edges.
  // Neutral sources let the film supply the saturated interference colors.
  function softbox(name, p, size, tint, intensity, round = false) {
    const group = new THREE.Group();
    group.name = name;
    group.position.fromArray(p);
    group.lookAt(0, 0, 0);
    room.add(group);
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
    });
    const point = uv().sub(0.5).mul(2);
    const distance = round ? point.length() : point.x.abs().max(point.y.abs());
    material.colorNode = color(tint).mul(
      mix(0.28, 1, distance.smoothstep(0.12, 1).oneMinus()).mul(intensity),
    );
    const geometry = round
      ? new THREE.CircleGeometry(0.5, 8)
      : new THREE.PlaneGeometry();
    const panel = new THREE.Mesh(geometry, material);
    panel.scale.set(size[0], size[1], 1);
    group.add(panel);
    if (round) {
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.53, 0.45, 0.22, 8),
        black,
      );
      shell.rotation.x = Math.PI / 2;
      shell.scale.set(size[0], 1, size[1]);
      shell.position.z = -0.13;
      group.add(shell);
    } else
      box(
        "Softbox housing",
        [0, 0, -0.14],
        [size[0] + 0.12, size[1] + 0.12, 0.25],
        black,
        group,
      );
    return group;
  }
  softbox("Large key octabox", [-5, 7, 4], [7, 7], "#f0f6ff", 8, true);
  softbox("Gentle fill octabox", [7, 5, 5], [5, 5], "#fff1df", 2.8, true);
  softbox(
    "Small overhead octabox",
    [1, 10, -3],
    [3.6, 3.6],
    "#ffffff",
    5,
    true,
  );
  softbox("Tall cool rim", [-7, 4, -5], [1.3, 7], "#e2efff", 6);
  softbox("Warm rim", [7, 5, -6], [2.4, 5.5], "#fff1e1", 5);

  // Frosted windows add structure without scattering point highlights.
  const window = softbox(
    "Frosted studio window",
    [-11.7, 5, -1],
    [6, 6],
    "#e8f1ff",
    1.8,
  );
  for (const x of [-1, 1])
    box("Window mullion", [x, 0, 0.025], [0.065, 6, 0.04], black, window);
  box("Window transom", [0, 0, 0.025], [6, 0.065, 0.04], black, window);

  // Negative fill and white bounce cards create broad dark/light transitions.
  const flag = box("Key flag", [-5, 2.4, 7], [2.3, 8, 0.12], black);
  flag.rotation.y = -0.4;
  const flag2 = box("Rim flag", [5, 2, -7], [1.5, 7, 0.12], black);
  flag2.rotation.y = 0.35;
  const card = box("White bounce", [9, 1, 1], [0.12, 6, 4], bounce);
  card.rotation.y = -0.3;
  const card2 = box("Low bounce", [-4, -2, -8], [6, 2, 0.12], bounce);
  card2.rotation.y = 0.2;
  for (const z of [-7, 0, 7])
    box("Ceiling beam", [0, 11.8, z], [24, 0.4, 0.25], black);

  // Bake-only point lights illuminate walls and bounce cards. Diffusion faces
  // supply the specular shapes; this is not path-traced multi-bounce lighting.
  for (const [p, tint, power] of [
    [[-5, 6, 4], "#eef5ff", 900],
    [[7, 4, 5], "#fff0dc", 450],
    [[2, 7, -5], "#edf3ff", 600],
  ]) {
    const light = new THREE.PointLight(tint, power);
    light.position.fromArray(p);
    room.add(light);
  }
  room.add(new THREE.HemisphereLight("#c2d2e2", "#24211d", 0.12));
  // Clockwise when viewed from above (+Y).
  room.rotation.y = -Math.PI / 2;
  return room;
}

export function createStudioEnvironment(renderer) {
  const room = createStudioRoom(),
    generator = new THREE.PMREMGenerator(renderer);
  try {
    return generator.fromScene(room, 0.015, 0.1, 100);
  } finally {
    generator.dispose();
    const resources = new Set();
    room.traverse((object) => {
      if (object.geometry) resources.add(object.geometry);
      if (object.material) resources.add(object.material);
    });
    for (const resource of resources) resource.dispose();
  }
}
