import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  Fn,
  attribute,
  color,
  mix,
  positionGeometry,
  positionPrevious,
  uniform,
  uv,
  vec3,
} from "three/tsl";

// Two batches share the same continuous wind field in beauty and shadow passes.
// Branch flexibility grows toward the tips; the leaf roots stay on their twigs.
export function createFoliage(parent, windowRecess = 0) {
  const time = uniform(0),
    previousTime = uniform(0);
  const flex = attribute("branchFlex", "float"),
    flutter = attribute("leafFlex", "float");
  const seed = attribute("plantSeed", "float");
  function deform(t) {
    const p = positionGeometry;
    // Broad, uneven gusts move the canopy across the paper, with quicker
    // flutter at the leaf tips. Both captures use this exact deformation.
    const envelope = t.mul(0.31).sin().mul(0.25).add(0.85);
    const gust = t
      .mul(0.85)
      .add(p.x.mul(0.16))
      .add(p.y.mul(0.12))
      .sin()
      .mul(1.25)
      .add(t.mul(1.47).add(p.x.mul(0.09)).sin().mul(0.5))
      .mul(envelope);
    const tremble = t.mul(3.6).add(seed.mul(17)).sin().mul(flutter).mul(0.16);
    return p.add(
      vec3(
        gust.mul(flex).add(tremble),
        gust.mul(flex).mul(0.12).add(tremble.mul(0.3)),
        gust.mul(flex).mul(0.18).add(tremble.mul(0.45)),
      ),
    );
  }
  const windPosition = Fn(() => {
    positionPrevious.assign(deform(previousTime));
    return deform(time);
  })();
  const leaves = new THREE.MeshStandardNodeMaterial({
    roughness: 0.74,
    side: THREE.DoubleSide,
  });
  const pigment = mix(color("#52642c"), color("#aeb865"), seed);
  const vein = uv().x.sub(0.5).abs().smoothstep(0.008, 0.035).oneMinus();
  leaves.colorNode = pigment
    .mul(uv().y.mul(0.15).add(0.88))
    .add(color("#bbbe7c").mul(vein.mul(0.14)));
  leaves.emissiveNode = pigment.mul(0.28);
  leaves.positionNode = windPosition;
  const wood = new THREE.MeshStandardNodeMaterial({
    color: "#786d43",
    roughness: 0.9,
  });
  wood.positionNode = windPosition;

  let randomState = 1967;
  const random = () =>
    (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) /
    4294967296;
  const leafParts = [],
    branchParts = [];
  const leaf = new THREE.PlaneGeometry(1, 1, 4, 8);
  const lp = leaf.attributes.position,
    lu = leaf.attributes.uv;
  for (let i = 0; i < lp.count; i++) {
    const t = lu.getY(i),
      across = lu.getX(i) * 2 - 1;
    const width = Math.pow(Math.sin(Math.PI * t), 0.8) * 0.17;
    lp.setXYZ(
      i,
      across * width,
      t,
      Math.sin(Math.PI * t) * (0.065 + Math.abs(across) * 0.045) -
        t * t * 0.11,
    );
  }
  leaf.computeVertexNormals();
  function decorate(geometry, leafSeed, isLeaf = false) {
    const p = geometry.attributes.position;
    const flexibility = [],
      fluttering = [],
      seeds = [];
    for (let i = 0; i < p.count; i++) {
      flexibility.push(
        Math.max(0, Math.min(1.5, (p.getY(i) + 5) / 30)) ** 1.5,
      );
      fluttering.push(isLeaf ? geometry.attributes.uv.getY(i) ** 2 : 0);
      seeds.push(leafSeed);
    }
    geometry.setAttribute(
      "branchFlex",
      new THREE.Float32BufferAttribute(flexibility, 1),
    );
    geometry.setAttribute(
      "leafFlex",
      new THREE.Float32BufferAttribute(fluttering, 1),
    );
    geometry.setAttribute(
      "plantSeed",
      new THREE.Float32BufferAttribute(seeds, 1),
    );
    return geometry;
  }
  const axis = new THREE.Vector3(0, 1, 0);
  function branch(a, b, radius) {
    const d = b.clone().sub(a),
      geometry = new THREE.CylinderGeometry(
        radius * 0.45,
        radius,
        d.length(),
        6,
        4,
      );
    geometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(axis, d.normalize()),
    );
    geometry.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
    branchParts.push(decorate(geometry, 0));
  }
  // Upright stems outside the left jamb, with irregular arching side branches.
  for (let i = 0; i < 8; i++) {
    const near = i < 3;
    const root = new THREE.Vector3(
      -19 + random() * 4,
      -5,
      (near ? -27.1 - random() * 1.1 : -32 - random() * 7) - windowRecess,
    );
    const crown = root
      .clone()
      .add(
        new THREE.Vector3(
          1 + random() * 4,
          26 + random() * 5,
          -random() * 0.5,
        ),
      );
    branch(root, crown, 0.055 + random() * 0.025);
    for (let j = 0; j < 5; j++) {
      const start = root.clone().lerp(crown, 0.53 + j * 0.085);
      const end = start
        .clone()
        .add(
          new THREE.Vector3(
            3 + random() * (near ? 7 : 11),
            0.4 + random() * 2.8,
            -random() * 0.7,
          ),
        );
      const middle = start
        .clone()
        .lerp(end, 0.55)
        .add(new THREE.Vector3(0, 0.8, 0));
      const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
      let last = start;
      for (let k = 1; k <= 7; k++) {
        const tip = curve.getPoint(k / 7);
        branch(last, tip, 0.022 * (1 - k / 10));
        last = tip;
      }
      for (let k = 1; k <= 10; k++) {
        const point = curve.getPoint((k - 0.4) / 10),
          side = k % 2 ? 1 : -1;
        const tip = point
          .clone()
          .add(
            new THREE.Vector3(
              0.15 + random() * 0.35,
              -0.15 - random() * 0.3,
              side * (0.25 + random() * 0.4),
            ),
          );
        branch(point, tip, 0.009);
        const direction = new THREE.Vector3(
          0.15 + random() * 0.7,
          -0.65 - random() * 0.7,
          side * (0.3 + random() * 0.5),
        ).normalize();
        const geometry = leaf.clone();
        geometry.scale(0.75 + random() * 0.55, 0.65 + random() * 0.65, 1);
        geometry.rotateY(random() * Math.PI);
        geometry.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(axis, direction),
        );
        geometry.translate(...tip.toArray());
        leafParts.push(
          decorate(geometry, random() * 0.5 + (near ? 0 : 0.5), true),
        );
      }
    }
  }
  leaf.dispose();
  const meshes = [];
  for (const [parts, material] of [
    [branchParts, wood],
    [leafParts, leaves],
  ]) {
    const geometry = mergeGeometries(parts);
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius += 4;
    parts.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    // Paper transmits a softly filtered glimpse of the nearest green leaves.
    mesh.layers.set(0);
    mesh.receiveShadow = false;
    mesh.userData.skipSSR = true;
    mesh.name = material === leaves ? "Windblown leaves" : "Living branches";
    parent.add(mesh);
    meshes.push(mesh);
  }
  return {
    time,
    previousTime,
    meshes,
    advance(dt) {
      time.value += dt;
    },
    commit() {
      previousTime.value = time.value;
    },
    reset() {
      time.value = previousTime.value = 0;
    },
    dispose() {
      leaves.dispose();
      wood.dispose();
    },
  };
}
