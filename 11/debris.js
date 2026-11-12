import * as THREE from "three/webgpu";

export function createDebris(scene) {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshStandardNodeMaterial({
    color: "#ffffff",
    metalness: 0.78,
    roughness: 0.36,
  });
  const bursts = [],
    pose = new THREE.Object3D();
  const chipColor = new THREE.Color();
  function burst(point, seed = 0, strength = 1) {
    const count = 1000,
      mesh = new THREE.InstancedMesh(geometry, material, count),
      items = [];
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    let state = 1237 + seed * 981;
    const random = () =>
      (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2,
        z = random() * 2 - 1,
        r = Math.sqrt(1 - z * z),
        speed = (0.25 + random() ** 2 * 2.5) * strength;
      const size =
        i < 50 ? 0.012 + random() * 0.02 : 0.002 + random() ** 3 * 0.01;
      items.push({
        p: [
          point.x + (random() - 0.5) * 0.25,
          point.y + (random() - 0.5) * 0.12,
          point.z + (random() - 0.5) * 0.1,
        ],
        v: [
          Math.cos(a) * r * speed,
          Math.sin(a) * r * speed + 0.15,
          z * speed * 0.7,
        ],
        spin: [random() * 8, random() * 9, random() * 7],
        size,
        flat: 0.15 + random() * 0.55,
      });
      if (i % 4 === 0) {
        const grey = 0.22 + random() * 0.4;
        chipColor.setRGB(grey, grey * 0.98, grey * 0.9);
      } else
        chipColor.setRGB(
          0.11 + random() * 0.24,
          0.055 + random() * 0.09,
          0.025 + random() * 0.04,
        );
      mesh.setColorAt(i, chipColor);
    }
    scene.add(mesh);
    bursts.push({ mesh, items, age: 0 });
    update(0);
  }
  function update(dt) {
    for (let b = bursts.length - 1; b >= 0; b--) {
      const burst = bursts[b];
      burst.age += dt;
      const t = burst.age;
      if (t > 5) {
        scene.remove(burst.mesh);
        burst.mesh.dispose();
        bursts.splice(b, 1);
        continue;
      }
      const fade = 1 - THREE.MathUtils.smoothstep(t, 3.5, 5);
      burst.items.forEach((v, i) => {
        pose.position.set(
          v.p[0] + v.v[0] * t,
          v.p[1] + v.v[1] * t - 0.43 * t * t,
          v.p[2] + v.v[2] * t,
        );
        pose.rotation.set(v.spin[0] * t, v.spin[1] * t, v.spin[2] * t);
        pose.scale.set(
          v.size * fade,
          v.size * v.flat * fade,
          v.size * 0.72 * fade,
        );
        pose.updateMatrix();
        burst.mesh.setMatrixAt(i, pose.matrix);
      });
      burst.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    burst,
    update,
    get count() {
      return bursts.length;
    },
    clear() {
      for (const b of bursts) {
        scene.remove(b.mesh);
        b.mesh.dispose();
      }
      bursts.length = 0;
    },
    dispose() {
      this.clear();
      geometry.dispose();
      material.dispose();
    },
  };
}
