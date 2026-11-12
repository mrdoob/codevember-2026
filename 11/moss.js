import * as THREE from "three/webgpu";
import {
  attribute,
  color,
  mix,
  positionGeometry,
  uniform,
  vec3,
  mx_noise_float,
  mx_fractal_noise_float,
} from "three/tsl";
import { ironNormal } from "./corrosion.js";

export function createMossMaterials() {
  const matMaterial = new THREE.MeshStandardNodeMaterial({
    roughness: 0.91,
    metalness: 0,
  });
  const variation = mx_fractal_noise_float(positionGeometry.mul(65), 3, 2, 0.5)
    .mul(0.8)
    .add(0.5)
    .clamp();
  matMaterial.colorNode = mix(color("#1d2c18"), color("#5b692f"), variation);
  matMaterial.normalNode = ironNormal(
    mx_noise_float(positionGeometry.mul(180))
      .mul(0.00065)
      .add(mx_noise_float(positionGeometry.mul(58)).mul(0.0012)),
  );
  const tipMaterial = new THREE.MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.84,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const clock = uniform(0).onObjectUpdate(
      ({ object }) => object.userData.moss.time,
    ),
    motion = uniform(new THREE.Vector3()).onObjectUpdate(
      ({ object }) => object.userData.moss.motion,
    );
  const flow = vec3(
    clock.mul(1.1).add(positionGeometry.y.mul(12)).sin().mul(0.004),
    clock.mul(0.7).add(positionGeometry.x.mul(9)).sin().mul(0.001),
    clock.mul(0.8).add(positionGeometry.z.mul(11)).cos().mul(0.003),
  );
  tipMaterial.positionNode = positionGeometry.add(
    flow.add(motion).mul(attribute("mossFlex", "float")),
  );
  return { matMaterial, tipMaterial };
}

// Low, irregular cushions with thousands of fine tips. Both layers share the
// mine's local frame, so the moss remains attached during every tug and recoil.
export function* buildMoss(parent, horns, seed, materials) {
  let state = (seed + 17) * 73193;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const patches = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI * 2) / 10 + (random() - 0.5) * 0.25;
    patches.push({
      normal: new THREE.Vector3(
        Math.sin(a),
        0.055 + random() * 0.06,
        Math.cos(a),
      ).normalize(),
      width: 0.12 + random() * 0.11,
      height: 0.035 + random() * 0.035,
    });
  }
  for (let i = 1; i < horns.length; i++) {
    if (i % 3 === 0) continue;
    const n = horns[i],
      down = new THREE.Vector3(0, -1, 0).addScaledVector(n, n.y).normalize();
    patches.push({
      normal: n.clone().addScaledVector(down, 0.22).normalize(),
      width: 0.09 + random() * 0.06,
      height: 0.065 + random() * 0.055,
    });
  }
  for (let i = 0; i < 9; i++) {
    const a = (i * Math.PI * 2) / 9 + 0.2,
      lat = -0.4 - random() * 0.7;
    patches.push({
      normal: new THREE.Vector3(
        Math.sin(a) * Math.cos(lat),
        Math.sin(lat),
        Math.cos(a) * Math.cos(lat),
      ),
      width: 0.11 + random() * 0.13,
      height: 0.08 + random() * 0.11,
    });
  }
  const matP = [],
    matN = [],
    matI = [],
    tipP = [],
    tipN = [],
    tipC = [],
    tipW = [],
    tipI = [];
  const baseColor = new THREE.Color("#263820"),
    tipColor = new THREE.Color("#84924b"),
    shade = new THREE.Color();
  const point = new THREE.Vector3(),
    normal = new THREE.Vector3();
  let tips = 0;
  for (const patch of patches) {
    yield;
    const n = patch.normal,
      u = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), n)
        .normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize(),
      phase = random() * Math.PI * 2;
    function surface(x, y, lift = 0) {
      normal
        .copy(n)
        .addScaledVector(u, x / 1.28)
        .addScaledVector(v, y / 1.28)
        .normalize();
      // Keep cushions just above the cast surface and the raised seam band.
      const seam = Math.max(0, 1 - Math.abs(normal.y * 1.28) / 0.065);
      return point.copy(normal).multiplyScalar(1.286 + seam * 0.02 + lift);
    }
    function outline(a) {
      return (
        1 +
        0.16 * Math.sin(a * 5 + phase) +
        0.1 * Math.sin(a * 9 - phase * 2) +
        0.06 * Math.cos(a * 13 + phase)
      );
    }
    const start = matP.length / 3,
      rings = 5,
      sides = 40;
    for (let r = 0; r <= rings; r++)
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2,
          t = r / rings,
          edge = outline(a);
        const x = Math.cos(a) * patch.width * t * edge,
          y = Math.sin(a) * patch.height * t * edge;
        const lift = (1 - t * t) * (0.009 + 0.003 * Math.sin(x * 160 + y * 90));
        surface(x, y, lift);
        matP.push(...point.toArray());
        matN.push(...normal.toArray());
        if (r < rings && j < sides) {
          const k = start + r * (sides + 1) + j;
          matI.push(
            k,
            k + sides + 1,
            k + 1,
            k + 1,
            k + sides + 1,
            k + sides + 2,
          );
        }
      }
    const count = Math.round(120 + patch.width * patch.height * 5500);
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2,
        t = Math.sqrt(random()),
        edge = outline(a);
      const x = Math.cos(a) * patch.width * t * edge,
        y = Math.sin(a) * patch.height * t * edge;
      surface(x, y, (1 - t * t) * 0.012);
      const root = point.clone(),
        out = normal.clone(),
        length = (0.012 + random() * 0.035) * (1 - t * 0.35),
        width = 0.0015 + random() * 0.0018;
      const lean = u
        .clone()
        .multiplyScalar((random() - 0.5) * 0.6)
        .addScaledVector(v, (random() - 0.5) * 0.6);
      const twist = random() * Math.PI * 2,
        tone = 0.3 + random() * 0.7;
      for (let blade = 0; blade < 2; blade++) {
        const angle = twist + (blade * Math.PI) / 2,
          side = u
            .clone()
            .multiplyScalar(Math.cos(angle))
            .addScaledVector(v, Math.sin(angle));
        const face = new THREE.Vector3().crossVectors(side, out).normalize(),
          offset = tipP.length / 3;
        for (let segment = 0; segment < 3; segment++)
          for (const sign of [-1, 1]) {
            const h = segment / 2;
            const p = root
              .clone()
              .addScaledVector(out, length * h)
              .addScaledVector(lean, length * h * h)
              .addScaledVector(side, sign * width * (1 - h * 0.92));
            tipP.push(...p.toArray());
            tipN.push(...face.toArray());
            tipW.push(h * h);
            shade
              .copy(baseColor)
              .lerp(tipColor, h * 0.7 * tone)
              .multiplyScalar(0.8 + tone * 0.3);
            tipC.push(...shade.toArray());
          }
        tipI.push(
          offset,
          offset + 1,
          offset + 2,
          offset + 1,
          offset + 3,
          offset + 2,
          offset + 2,
          offset + 3,
          offset + 4,
          offset + 3,
          offset + 5,
          offset + 4,
        );
      }
      tips++;
    }
  }
  function geometry(p, n, indices) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
    g.setIndex(indices);
    g.computeBoundingSphere();
    return g;
  }
  const matGeometry = geometry(matP, matN, matI),
    tipGeometry = geometry(tipP, tipN, tipI);
  tipGeometry.setAttribute("color", new THREE.Float32BufferAttribute(tipC, 3));
  tipGeometry.setAttribute(
    "mossFlex",
    new THREE.Float32BufferAttribute(tipW, 1),
  );
  const { matMaterial, tipMaterial } = materials;
  const mats = new THREE.Mesh(matGeometry, matMaterial),
    tufts = new THREE.Mesh(tipGeometry, tipMaterial);
  mats.name = "Moss cushions in seams and crevices";
  tufts.name = "Fine moss tips";
  mats.castShadow = mats.receiveShadow = tufts.receiveShadow = true;
  parent.add(mats, tufts);
  const rotation = new THREE.Quaternion();
  const motion = new THREE.Vector3();
  tufts.userData.moss = { time: 0, motion };
  return {
    mats,
    tufts,
    patches: patches.length,
    tips,
    update(time, body) {
      tufts.userData.moss.time = time;
      motion
        .fromArray(body.velocity)
        .applyQuaternion(rotation.fromArray(body.quaternion).invert())
        .clampLength(0, 3)
        .multiplyScalar(-0.006);
    },
    dispose() {
      parent.remove(mats, tufts);
      matGeometry.dispose();
      tipGeometry.dispose();
    },
  };
}
