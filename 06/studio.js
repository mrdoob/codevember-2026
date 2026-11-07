import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RectAreaLightTexturesLib } from "three/addons/lights/RectAreaLightTexturesLib.js";
import { color, mix, positionWorld, uv, float, uniform } from "three/tsl";
import { createPCSSFilter } from "./pcss-shadow.js";
import { travertine } from "./surface-materials.js";
import { createInterior, WINDOW_LAYOUT, WINDOW_OPENING } from "./room.js";
import { createCaustics } from "./caustics.js";
import { addMesh } from "./geometry.js";
import { SphereAreaLight } from "./sphere-area-light.js";

export function createStudio(scene, renderer, model) {
  const ltc = RectAreaLightTexturesLib.init();
  THREE.RectAreaLightNode.setLTC(ltc);
  SphereAreaLight.setLTC(ltc);
  scene.background = new THREE.Color("#edd6b9");
  scene.fog = new THREE.Fog("#d4c4a9", 100, 200);
  const group = new THREE.Group(),
    room = new THREE.Group();
  scene.add(group);
  group.add(room);
  room.rotation.y = 0;
  room.scale.set(21 / 26, 1, 21 / 26);
  room.updateMatrixWorld(true);
  const interior = createInterior(room);

  const environmentScene = new THREE.Scene();
  const surround = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  surround.colorNode = mix(
    color("#796453"),
    color("#e9d8c5"),
    positionWorld.normalize().y.mul(0.5).add(0.5),
  );
  environmentScene.add(
    new THREE.Mesh(new THREE.SphereGeometry(70, 32, 16), surround),
  );
  for (const panel of [
    {
      p: [WINDOW_OPENING.x, WINDOW_OPENING.y, -26 - WINDOW_OPENING.recess],
      s: [WINDOW_OPENING.w * room.scale.x, WINDOW_OPENING.h],
      c: "#ffe8cc",
      power: 3,
      columns: WINDOW_LAYOUT.panels * WINDOW_LAYOUT.columns,
      rows: WINDOW_LAYOUT.rows,
      panels: WINDOW_LAYOUT.panels,
      rotation: 0,
    },
    {
      p: [0, 10, 25],
      s: [18, 13],
      c: "#d5bca4",
      power: 0.7,
      rotation: Math.PI,
    },
    { p: [0, 20, -2], s: [28, 24], c: "#eee4d4", power: 1.6 },
  ]) {
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
    });
    const edge = uv().sub(0.5).abs().mul(2);
    let feather = float(1)
      .sub(edge.x.smoothstep(0.96, 1))
      .mul(float(1).sub(edge.y.smoothstep(0.96, 1)));
    if (panel.columns) {
      const gx = uv().x.mul(panel.columns).fract(),
        gy = uv().y.mul(panel.rows).fract(),
        sash = uv().x.mul(panel.panels).fract();
      feather = feather.mul(
        gx
          .smoothstep(0.01, 0.025)
          .mul(gx.smoothstep(0.975, 0.99).oneMinus())
          .mul(gy.smoothstep(0.01, 0.025))
          .mul(gy.smoothstep(0.975, 0.99).oneMinus())
          .mul(sash.smoothstep(0.005, 0.02))
          .mul(sash.smoothstep(0.98, 0.995).oneMinus()),
      );
    }
    material.colorNode = color(panel.c).mul(panel.power).mul(feather);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(...panel.s),
      material,
    );
    mesh.position.copy(room.localToWorld(new THREE.Vector3(...panel.p)));
    if (panel.rotation !== undefined)
      mesh.rotation.y = panel.rotation + room.rotation.y;
    else mesh.lookAt(0, 5, 0);
    environmentScene.add(mesh);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(environmentScene, 0.02, 0.1, 150, {
    position: new THREE.Vector3(0, 5, 0),
  });
  scene.environment = environment.texture;
  environmentScene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  pmrem.dispose();

  // The distant rectangular source shines through the real window and leaves.
  const key = new THREE.ProjectorLight("#ffe6c9", 2.7, 0, 0.14, 0.08, 0);
  key.name = "Window sunlight";
  key.position.set(-28, 25, -70);
  key.target.position.set(
    WINDOW_OPENING.x,
    WINDOW_OPENING.y,
    -26 - WINDOW_OPENING.recess,
  );
  key.aspect = 1.6;
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 100;
  key.shadow.camera.layers.enable(2);
  key.shadow.camera.far = 280;
  key.shadow.normalBias = 0.008;
  key.shadow.bias = -0.00001;
  key.shadow.autoUpdate = false;
  const softness = uniform(1.5);
  key.shadow.filterNode = createPCSSFilter(softness).filter;
  room.add(key, key.target);
  const fill = new THREE.HemisphereLight("#f5e5d5", "#a88166", 0.18);
  scene.add(fill);
  const windowLight = new THREE.RectAreaLight(
    "#fff0df",
    5,
    WINDOW_OPENING.w * room.scale.x,
    WINDOW_OPENING.h,
  );
  windowLight.position.set(
    WINDOW_OPENING.x,
    WINDOW_OPENING.y,
    -25.9 - WINDOW_OPENING.recess,
  );
  windowLight.rotation.y = Math.PI;
  const secondWindowLight = new THREE.RectAreaLight("#e6cbb0", 0.65, 18, 13);
  secondWindowLight.position.set(0, 10, 25);
  secondWindowLight.name = "Diffuse room bounce";
  room.add(windowLight, secondWindowLight);

  const floorMaterial = travertine({ roughness: 0, bumpStrength: 1.8 });
  const caustics = createCaustics();
  for (const material of [...interior.receivers, floorMaterial]) {
    material.emissiveNode = caustics.node.mul(
      material.colorNode || color(material.color),
    );
  }
  const floor = addMesh(
    group,
    new RoundedBoxGeometry(9, 4.5, 9, 2, 0.025),
    floorMaterial,
    0,
    -2.25,
    0,
  );
  floor.rotation.y = 0;
  // Only the instrument and pedestal need to cast into the sun's cube map.
  // The near plane starts outside the luminous globe and its internal spindle.
  const sunLight = new SphereAreaLight("#ffdda0", 8, 0.72, 45);
  sunLight.name = "Orrery sun";
  model.sunGroup.getWorldPosition(sunLight.position);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(512, 512);
  sunLight.shadow.camera.near = 0.8;
  sunLight.shadow.camera.far = 40;
  sunLight.shadow.camera.layers.set(3);
  sunLight.shadow.normalBias = 0.012;
  sunLight.shadow.bias = -0.0001;
  sunLight.shadow.radius = 16;
  sunLight.shadow.autoUpdate = false;
  model.group.traverse((object) => {
    if (
      object.isMesh &&
      object.castShadow &&
      object.parent !== model.sunGroup
    )
      object.layers.enable(3);
  });
  floor.layers.enable(3);
  scene.add(sunLight);
  const duskColor = new THREE.Color("#ff9b56"),
    daylightColor = new THREE.Color("#ffe6c9"),
    skyColor = scene.background.clone();
  const windowCentre = room.localToWorld(
    new THREE.Vector3(
      WINDOW_OPENING.x,
      WINDOW_OPENING.y,
      -26 - WINDOW_OPENING.recess,
    ),
  );
  return {
    key,
    sunLight,
    fill,
    windowLight,
    secondWindowLight,
    floor,
    group,
    room,
    softness,
    foliage: interior.foliage,
    paperFoliage: interior.paperFoliage,
    caustics,
    setLight(value) {
      const sunset = 1 - value;
      const elevation = THREE.MathUtils.lerp(-0.06, 0.27, value);
      const azimuth = -0.414 - sunset * 0.09;
      // The sun follows an angular path at a fixed, distant radius. Keeping
      // the projector centred on the window avoids a moving spotlight cutoff.
      key.position
        .set(
          Math.sin(azimuth) * Math.cos(elevation),
          Math.sin(elevation),
          -Math.cos(azimuth) * Math.cos(elevation),
        )
        .multiplyScalar(180)
        .add(windowCentre);
      room.worldToLocal(key.position);
      key.intensity =
        2.7 *
        Math.sqrt(value) *
        THREE.MathUtils.smoothstep(elevation, -0.012, 0.035);
      fill.intensity = THREE.MathUtils.lerp(0.035, 0.18, value);
      windowLight.intensity = THREE.MathUtils.lerp(0.18, 2, value);
      secondWindowLight.intensity = THREE.MathUtils.lerp(0.1, 0.65, value);
      scene.environmentIntensity = THREE.MathUtils.lerp(0.15, 0.45, value);
      key.color.lerpColors(duskColor, daylightColor, value);
      scene.background
        .copy(skyColor)
        .multiplyScalar(THREE.MathUtils.lerp(0.12, 1, value));
      for (const light of interior.nicheLights)
        light.intensity = THREE.MathUtils.lerp(8, 18, value);
    },
    dispose() {
      interior.foliage.dispose();
      interior.paperFoliage.dispose();
      environment.dispose();
      key.shadow.dispose();
      sunLight.shadow.dispose();
      for (const light of interior.nicheLights) light.shadow.dispose();
      sunLight.removeFromParent();
      const geometries = new Set();
      group.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
      });
      geometries.forEach((g) => g.dispose());
      [...interior.materials, floorMaterial].forEach((m) => m.dispose());
    },
  };
}
