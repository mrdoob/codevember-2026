import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  color,
  mix,
  positionWorld,
  positionLocal,
  uv,
  vec3,
  vec2,
  mx_noise_float,
  mx_fractal_noise_float,
  bumpMap,
  float,
  Fn,
} from "three/tsl";
import { plaster, travertine } from "./surface-materials.js";
import { createFoliage } from "./foliage.js";
import { createPaperFoliage } from "./paper-foliage.js";
import { addMesh, rod, consolidate } from "./geometry.js";

export const WINDOW_LAYOUT = { panels: 4, columns: 4, rows: 5 };
export const WINDOW_OPENING = { x: 0, y: 7.5, w: 32, h: 16.5, recess: 1.2 };

const bottom = -4.51,
  top = 18.5;

export function createInterior(room) {
  const walls = new THREE.Group();
  room.add(walls);
  const wallMaterial = plaster();
  wallMaterial.shadowSide = THREE.DoubleSide;
  const wood = new THREE.MeshStandardNodeMaterial({
    color: "#a87b50",
    roughness: 0.44,
  });
  const grain = mx_noise_float(positionWorld.mul(vec3(28, 0.45, 28)));
  wood.colorNode = color("#a87b50").mul(grain.mul(0.22).add(1));
  wood.normalNode = bumpMap(grain.mul(0.001));
  const windowWood = wood.clone();
  windowWood.colorNode = color("#a48661").mul(grain.mul(0.13).add(1));
  windowWood.roughness = 0.5;
  const railWood = windowWood.clone();
  const railGrain = mx_noise_float(positionWorld.mul(vec3(0.45, 28, 28)));
  railWood.colorNode = color("#a48661").mul(railGrain.mul(0.13).add(1));
  railWood.normalNode = bumpMap(railGrain.mul(0.0007));
  const darkWood = wood.clone();
  darkWood.colorNode = color("#94673f").mul(grain.mul(0.28).add(1));
  const leaf = new THREE.MeshStandardNodeMaterial({
    color: "#959653",
    emissive: "#65743a",
    emissiveIntensity: 0.25,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const bark = new THREE.MeshStandardNodeMaterial({
    color: "#62533b",
    roughness: 0.85,
  });
  const bronze = new THREE.MeshStandardNodeMaterial({
    color: "#b69b6a",
    metalness: 0.8,
    roughness: 0.3,
  });
  const ceramic = new THREE.MeshPhysicalNodeMaterial({
    color: "#998d79",
    roughness: 0.24,
    clearcoat: 0.75,
    clearcoatRoughness: 0.12,
  });
  const ceramicGrain = mx_noise_float(positionLocal.mul(68));
  ceramic.colorNode = color("#998d79").mul(
    mx_noise_float(positionLocal.mul(3))
      .mul(0.13)
      .add(ceramicGrain.mul(0.06))
      .add(1),
  );
  ceramic.normalNode = bumpMap(ceramicGrain.mul(0.0006));
  const petals = new THREE.MeshStandardNodeMaterial({
    color: "#fff9ef",
    roughness: 0.48,
    side: THREE.DoubleSide,
  });
  const pollen = new THREE.MeshStandardNodeMaterial({
    color: "#d5b46c",
    roughness: 0.7,
  });
  const ceilingMaterial = new THREE.MeshStandardNodeMaterial({
    color: "#c5b09c",
    roughness: 0.85,
  });
  const tileMaterial = travertine({ roughness: 0 });
  // The floor keeps its UVs after merging, so the grid follows the room.
  // Fourteen tiles preserve the 3-unit spacing across the 42-unit floor.
  const tileUV = uv().mul(14),
    cell = tileUV.floor(),
    f = tileUV.fract();
  const edge = f.min(f.oneMinus());
  const face = edge.x.min(edge.y).mul(3).smoothstep(0.012, 0.04);
  // Match the polished pedestal's stone response, keeping the grout matte.
  tileMaterial.roughnessNode = mix(0.72, tileMaterial.roughnessNode, face);
  const variation = mx_noise_float(vec3(cell.x, 3, cell.y))
    .mul(0.1)
    .add(1);
  const stoneGrain = mx_noise_float(positionWorld.mul(40));
  tileMaterial.colorNode = mix(
    color("#a89882"),
    color("#cec0aa").mul(variation),
    face,
  ).mul(stoneGrain.mul(0.025).add(1));
  tileMaterial.normalNode = bumpMap(
    face.mul(0.008).add(stoneGrain.mul(0.0008)),
  );

  // Rectangular openings are real holes in the wall surface.
  function wall(position, rotation, holes = []) {
    const frame = new THREE.Group();
    frame.position.fromArray(position);
    frame.rotation.y = rotation;
    walls.add(frame);
    const xs = [
      ...new Set([
        -26,
        26,
        ...holes.flatMap((h) => [h.x - h.w / 2, h.x + h.w / 2]),
      ]),
    ].sort((a, b) => a - b);
    const ys = [
      ...new Set([
        bottom,
        top,
        ...holes.flatMap((h) => [h.y - h.h / 2, h.y + h.h / 2]),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++)
      for (let j = 0; j < ys.length - 1; j++) {
        const x = (xs[i] + xs[i + 1]) / 2,
          y = (ys[j] + ys[j + 1]) / 2;
        if (
          holes.some(
            (h) => Math.abs(x - h.x) < h.w / 2 && Math.abs(y - h.y) < h.h / 2,
          )
        )
          continue;
        addMesh(
          frame,
          new THREE.PlaneGeometry(xs[i + 1] - xs[i], ys[j + 1] - ys[j]),
          wallMaterial,
          x,
          y,
          0,
        );
      }
    return frame;
  }
  const opening = WINDOW_OPENING;
  const alcoves = [-12.5, 12.5].map((x) => ({ x, y: 5.3, w: 5, h: 9.1 }));
  const back = wall([0, 0, -26], 0, [opening]);
  const left = wall([-26, 0, 0], Math.PI / 2, alcoves);
  const right = wall([26, 0, 0], -Math.PI / 2, alcoves);
  const front = wall([0, 0, 26], Math.PI);
  // Continuous oak cornice makes the four views read as the same room.
  for (const frame of [back, left, right, front]) {
    addMesh(
      frame,
      new RoundedBoxGeometry(52, 0.25, 0.26, 2, 0.035),
      wood,
      0,
      top - 0.25,
      0.12,
    );
    addMesh(
      frame,
      new RoundedBoxGeometry(52, 0.2, 0.13, 2, 0.02),
      wallMaterial,
      0,
      bottom + 0.1,
      0.06,
    );
  }
  const floor = addMesh(
    walls,
    new THREE.PlaneGeometry(52, 52),
    tileMaterial,
    0,
    bottom,
    0,
  );
  floor.rotation.x = -Math.PI / 2;
  const ceiling = addMesh(
    walls,
    new THREE.PlaneGeometry(52, 52),
    ceilingMaterial,
    0,
    top,
    0,
  );
  ceiling.rotation.x = Math.PI / 2;

  let seed = 871;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const windowPanels = [];
  function windowFrame(frame, opening) {
    const g = new THREE.Group();
    g.name = "Paper window";
    frame.add(g);
    g.position.set(opening.x, opening.y, -opening.recess);
    const { panels, columns, rows } = WINDOW_LAYOUT;
    const panelWidth = opening.w / panels;
    // Plaster reveals connect the wall opening to the inset wooden screens.
    const depth = opening.recess + 0.8;
    for (const side of [-1, 1]) {
      addMesh(
        frame,
        new RoundedBoxGeometry(0.16, opening.h + 0.32, depth, 2, 0.015),
        wallMaterial,
        opening.x + side * (opening.w / 2 + 0.08),
        opening.y,
        -depth / 2,
      );
      addMesh(
        frame,
        new RoundedBoxGeometry(opening.w, 0.16, depth, 2, 0.015),
        wallMaterial,
        opening.x,
        opening.y + side * (opening.h / 2 + 0.08),
        -depth / 2,
      );
    }
    // Coplanar screens close the joints at oblique angles as well as head-on.
    // They meet the plaster reveal directly, without extra border trim.
    for (let i = 0; i < panels; i++) {
      const panel = new THREE.Group();
      panel.position.set(-opening.w / 2 + (i + 0.5) * panelWidth, 0, 0);
      panel.name = `Shoji panel ${i + 1}`;
      g.add(panel);
      windowPanels.push(panel);
      for (const side of [-1, 1]) {
        addMesh(
          panel,
          new RoundedBoxGeometry(0.22, opening.h - 0.12, 0.22, 2, 0.025),
          windowWood,
          side * (panelWidth / 2 - 0.11),
        );
        addMesh(
          panel,
          new RoundedBoxGeometry(panelWidth - 0.32, 0.22, 0.22, 2, 0.025),
          railWood,
          0,
          side * (opening.h / 2 - 0.17),
        );
      }
      for (let j = 1; j < columns; j++)
        addMesh(
          panel,
          new RoundedBoxGeometry(0.065, opening.h - 0.48, 0.12, 2, 0.012),
          windowWood,
          -panelWidth / 2 + (j * panelWidth) / columns,
          0,
          -0.02,
        );
      for (let j = 1; j < rows; j++)
        addMesh(
          panel,
          new RoundedBoxGeometry(panelWidth - 0.42, 0.075, 0.13, 2, 0.013),
          railWood,
          0,
          -opening.h / 2 + (j * opening.h) / rows,
          0.015,
        );
      // Recessed finger pulls belong to the moving screen stiles.
      const pullX = (i < 2 ? 1 : -1) * (panelWidth / 2 - 0.11);
      addMesh(
        panel,
        new RoundedBoxGeometry(0.11, 0.62, 0.025, 2, 0.016),
        darkWood,
        pullX,
        -1.65,
        0.115,
      );
    }
  }
  windowFrame(back, opening);
  const foliage = createFoliage(room, opening.recess);
  const paperFoliage = createPaperFoliage(foliage, room, opening);
  // Thin washi diffuses backlighting; exterior leaves shadow the paper itself.
  const glazing = new THREE.MeshSSSNodeMaterial({
    color: "#eee1ca",
    roughness: 0.85,
    transmission: 0,
    thickness: 0.001,
    ior: 1.1,
    specularIntensity: 0.05,
    envMapIntensity: 0.12,
    metalness: 0,
  });
  const fibreUV = uv().mul(vec2(750, 1250));
  const fibreWeight = fibreUV
    .fwidth()
    .length()
    .smoothstep(0.5, 1.5)
    .oneMinus();
  const fibres = mx_noise_float(fibreUV).mul(fibreWeight);
  const paperCloud = mx_fractal_noise_float(
    vec3(uv().mul(vec2(16, 10)), 4),
    3,
    2,
    0.5,
  );
  const gardenTint = mix(vec3(1), paperFoliage.node.rgb, 0.42);
  glazing.colorNode = color("#f4ead7")
    .mul(paperCloud.mul(0.05).add(fibres.mul(0.035)).add(1))
    .mul(gardenTint);
  glazing.normalNode = bumpMap(
    fibres.mul(0.00025).add(paperCloud.mul(0.001)),
  );
  glazing.thicknessColorNode = color("#fff0d3").mul(gardenTint);
  glazing.thicknessDistortionNode = float(0.08);
  glazing.thicknessAmbientNode = float(0.16);
  glazing.thicknessAttenuationNode = float(0.25);
  glazing.thicknessPowerNode = float(1.3);
  glazing.thicknessScaleNode = float(1.05);
  glazing.receivedShadowNode = Fn(([shadow]) => shadow.pow(1.15));
  glazing.userData.paper = true;
  const panes = [];
  for (const [i, panel] of windowPanels.entries()) {
    const geometry = new THREE.PlaneGeometry(
      opening.w / WINDOW_LAYOUT.panels,
      opening.h,
    );
    // All four sheets sample one garden projection, with no repeated leaves.
    const texcoords = geometry.attributes.uv;
    for (let j = 0; j < texcoords.count; j++)
      texcoords.setXY(
        j,
        (i + texcoords.getX(j)) / WINDOW_LAYOUT.panels,
        texcoords.getY(j),
      );
    const pane = addMesh(panel, geometry, glazing, 0, 0, -0.135);
    pane.name = `Washi sheet ${i + 1}`;
    pane.castShadow = false;
    pane.userData.skipSSR = true;
    panes.push(pane);
  }
  // Keep the paper outside the static mesh batches so its shadow and SSR flags
  // survive consolidation. Preserve its world transform when reparenting.
  room.updateMatrixWorld(true);
  for (const pane of panes) room.attach(pane);

  const nicheLights = [];
  // Twelve triangles per cupped petal; all blossoms merge into two room draws.
  const petalGeometry = new THREE.CircleGeometry(0.1, 12);
  const petalPositions = petalGeometry.attributes.position;
  for (let i = 1; i < petalPositions.count; i++)
    petalPositions.setZ(i, -0.025);
  petalGeometry.scale(0.72, 1.15, 1);
  petalGeometry.translate(0, 0.07, 0);
  petalGeometry.computeVertexNormals();
  function niche(frame, opening, variant) {
    const g = new THREE.Group();
    g.position.set(opening.x, opening.y - opening.h / 2, 0);
    g.name = `Vase niche ${variant + 1}`;
    g.userData.opening = { ...opening };
    frame.add(g);
    const { w, h } = opening,
      depth = 1.8;
    addMesh(g, new THREE.PlaneGeometry(w, h), wallMaterial, 0, h / 2, -depth);
    addMesh(
      g,
      new RoundedBoxGeometry(0.16, h, depth, 2, 0.035),
      wallMaterial,
      -w / 2,
      h / 2,
      -depth / 2,
    );
    addMesh(
      g,
      new RoundedBoxGeometry(0.16, h, depth, 2, 0.035),
      wallMaterial,
      w / 2,
      h / 2,
      -depth / 2,
    );
    for (const y of [0, h])
      addMesh(
        g,
        new RoundedBoxGeometry(w, 0.16, depth, 2, 0.035),
        wallMaterial,
        0,
        y,
        -depth / 2,
      );
    const shelfThickness = 0.18;
    addMesh(
      g,
      new RoundedBoxGeometry(w - 0.18, shelfThickness, depth + 0.12, 2, 0.02),
      railWood,
      0,
      0.08 + shelfThickness / 2,
      -depth / 2 + 0.06,
    );
    const arrangement = new THREE.Group();
    arrangement.position.y = shelfThickness;
    g.add(arrangement);
    const vaseProfile = new THREE.Path()
      .moveTo(0, 0)
      .lineTo(0.47, 0)
      .quadraticCurveTo(0.78, 0.1, 0.77, 0.75)
      .quadraticCurveTo(0.75, 1.25, 0.4, 1.6)
      .lineTo(0.32, 1.72)
      .lineTo(0.25, 1.72)
      .lineTo(0.29, 1.58)
      .quadraticCurveTo(0.66, 1.1, 0.65, 0.65)
      .lineTo(0.35, 0.15)
      .lineTo(0, 0.15);
    const vase = addMesh(
      arrangement,
      new THREE.LatheGeometry(vaseProfile.getPoints(10), 48),
      ceramic,
      0,
      0.08,
      -0.95,
    );
    const proportions = [
      [1, 1.12],
      [0.82, 1.48],
      [1.16, 0.92],
      [0.92, 1.28],
    ][variant];
    vase.scale.set(proportions[0], proportions[1], proportions[0]);
    for (let i = 0; i < 5; i++) {
      const a = [(random() - 0.5) * 0.3, 1.4 * proportions[1], -0.95],
        b = [
          (random() - 0.5) * 2.1,
          3.7 + random() * 1.6,
          -0.95 + (random() - 0.5) * 0.5,
        ];
      rod(arrangement, a, b, 0.016, bark);
      for (let j = 1; j <= 4; j++) {
        const point = new THREE.Vector3(...a).lerp(
          new THREE.Vector3(...b),
          j / 5,
        );
        const tip = point
          .clone()
          .add(
            new THREE.Vector3(
              (j % 2 ? 1 : -1) * (0.3 + random() * 0.25),
              0.3 + random() * 0.2,
              0,
            ),
          );
        rod(arrangement, point.toArray(), tip.toArray(), 0.009, bark);
        const bud = addMesh(
          arrangement,
          new THREE.SphereGeometry(0.075, 8, 6),
          leaf,
          ...tip.toArray(),
        );
        bud.scale.set(0.6, 1.5, 0.45);
        bud.rotation.z = random() - 0.5;
        if (j > 1) {
          const blossom = new THREE.Group();
          blossom.position.copy(tip);
          blossom.position.z += 0.045;
          blossom.rotation.set(
            (random() - 0.5) * 1.1,
            (random() - 0.5) * 1.2,
            random() * Math.PI,
          );
          blossom.scale.setScalar(0.85 + random() * 0.4);
          arrangement.add(blossom);
          for (let k = 0; k < 5; k++) {
            const petal = addMesh(blossom, petalGeometry.clone(), petals);
            petal.rotation.z = (k * Math.PI * 2) / 5;
          }
          addMesh(
            blossom,
            new THREE.SphereGeometry(0.032, 8, 6),
            pollen,
            0,
            0,
            0.012,
          );
        }
      }
    }
    const light = new THREE.SpotLight("#ffe7c3", 18, 12, 0.48, 0.9, 2);
    light.name = `Niche downlight ${variant + 1}`;
    light.castShadow = true;
    light.shadow.mapSize.set(256, 256);
    light.shadow.camera.near = 0.15;
    light.shadow.camera.layers.set(4);
    light.shadow.normalBias = 0.015;
    light.shadow.bias = -0.0001;
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = true;
    // Keep the wall wash without a visible emissive disk or fixture.
    light.position.set(0, h - 0.1, -1.25);
    light.target.position.set(0, h * 0.6, -depth);
    g.add(light, light.target);
    nicheLights.push(light);
  }
  for (const [i, frame] of [left, right].entries())
    alcoves.forEach((opening, j) => niche(frame, opening, i * 2 + j));
  petalGeometry.dispose();

  // Matching double oak doors occupy the wall opposite the window.
  const door = new THREE.Group();
  front.add(door);
  door.position.set(0, bottom, 0.1);
  const width = 20.5,
    height = 18.5;
  // Continuous casing and panel mouldings keep the bevels aligned at corners.
  const casing = new THREE.Shape()
    .moveTo(-width / 2 - 0.36, -0.2)
    .lineTo(-width / 2, -0.2)
    .lineTo(-width / 2, height - 0.02)
    .lineTo(width / 2, height - 0.02)
    .lineTo(width / 2, -0.2)
    .lineTo(width / 2 + 0.36, -0.2)
    .lineTo(width / 2 + 0.36, height + 0.34)
    .lineTo(-width / 2 - 0.36, height + 0.34);
  casing.closePath();
  addMesh(
    door,
    new THREE.ExtrudeGeometry(casing, {
      depth: 0.27,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.015,
      bevelSegments: 1,
    }),
    wood,
    0,
    0,
    -0.065,
  );
  for (const side of [-1, 1]) {
    const panel = new THREE.Group();
    panel.position.set((side * width) / 4, height / 2, 0.03);
    door.add(panel);
    addMesh(
      panel,
      new RoundedBoxGeometry(width / 2 - 0.05, height, 0.18, 2, 0.018),
      darkWood,
    );
    for (let i = -2; i <= 2; i++)
      addMesh(
        panel,
        new THREE.BoxGeometry(0.025, height - 0.45, 0.012),
        darkWood,
        i * 1.7,
        0,
        0.096,
      );
    const trimX = width / 4 - 0.18,
      trimY = height / 2 - 0.24;
    const moulding = new THREE.Shape()
      .moveTo(-trimX, -trimY)
      .lineTo(trimX, -trimY)
      .lineTo(trimX, trimY)
      .lineTo(-trimX, trimY);
    moulding.closePath();
    const inset = new THREE.Path()
      .moveTo(-trimX + 0.12, -trimY + 0.12)
      .lineTo(-trimX + 0.12, trimY - 0.12)
      .lineTo(trimX - 0.12, trimY - 0.12)
      .lineTo(trimX - 0.12, -trimY + 0.12);
    inset.closePath();
    moulding.holes.push(inset);
    addMesh(
      panel,
      new THREE.ExtrudeGeometry(moulding, {
        depth: 0.05,
        steps: 1,
        bevelEnabled: true,
        bevelThickness: 0.01,
        bevelSize: 0.008,
        bevelSegments: 1,
      }),
      wood,
      0,
      0,
      0.105,
    );
    const handleX = side * 0.85;
    addMesh(
      door,
      new RoundedBoxGeometry(0.38, 2.5, 0.1, 3, 0.05),
      bronze,
      handleX,
      8.1,
      0.22,
    );
    for (const y of [7.2, 9.0]) {
      rod(door, [handleX, y, 0.25], [handleX, y, 0.7], 0.105, bronze);
      const screw = addMesh(
        door,
        new THREE.CylinderGeometry(0.045, 0.045, 0.025, 12),
        darkWood,
        handleX,
        y + (y < 8 ? -0.22 : 0.22),
        0.285,
      );
      screw.rotation.x = Math.PI / 2;
    }
    addMesh(
      door,
      new THREE.CapsuleGeometry(0.105, 1.8, 6, 16),
      bronze,
      handleX,
      8.1,
      0.7,
    );
  }
  // Consolidating only meshes preserves the niche light/target groups.
  consolidate(walls);
  walls.traverse((object) => {
    if (object.isMesh) object.layers.enable(4);
    if (object.material === tileMaterial) {
      object.name = "Room floor";
      object.userData.skipSSR = true;
    }
  });
  for (const [name, material] of Object.entries({
    "Plaster walls": wallMaterial,
    "Oak shelves and trim": wood,
    "Window stiles": windowWood,
    "Window rails": railWood,
    "Door panels": darkWood,
    "Vase leaves": leaf,
    "Vase stems": bark,
    "Door hardware": bronze,
    "Glazed ceramic vases": ceramic,
    "Flower petals": petals,
    "Flower pollen": pollen,
    Ceiling: ceilingMaterial,
    "Stone floor tiles": tileMaterial,
    "Washi paper": glazing,
  }))
    material.name = name;
  return {
    nicheLights,
    foliage,
    paperFoliage,
    receivers: [
      wallMaterial,
      tileMaterial,
      wood,
      windowWood,
      railWood,
      darkWood,
      ceramic,
      petals,
      pollen,
      glazing,
    ],
    materials: [
      wallMaterial,
      wood,
      windowWood,
      railWood,
      darkWood,
      leaf,
      bark,
      bronze,
      ceramic,
      petals,
      pollen,
      ceilingMaterial,
      tileMaterial,
      glazing,
    ],
  };
}
