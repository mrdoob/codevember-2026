import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three/webgpu";
import { createMaterials } from "../materials.js";
import { createOrrery } from "../orrery.js";

// Measure the rendered geometry, including Saturn's tilted ring and struts.
// Rotation about Y preserves these swept envelopes.
function measure(objects, origin = new THREE.Vector3()) {
  const p = new THREE.Vector3();
  let inner = Infinity,
    outer = 0,
    sphere = 0;
  for (const root of objects)
    root.traverse((object) => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i)
          .applyMatrix4(object.matrixWorld)
          .sub(origin);
        const radius = Math.hypot(p.x, p.z);
        inner = Math.min(inner, radius);
        outer = Math.max(outer, radius);
        sphere = Math.max(sphere, p.length());
      }
    });
  return { inner, outer, sphere };
}

function withModel(check) {
  const materials = createMaterials(),
    model = createOrrery(materials);
  model.group.updateMatrixWorld(true);
  try {
    check(model);
  } finally {
    model.dispose();
    materials.dispose();
  }
}

test("planet and ring swept volumes remain separate at every orbital phase", () => {
  withModel((model) => {
    let previous = measure([model.sunGroup]);
    for (const { globe, body } of model.planets) {
      const current = measure([globe]);
      assert.ok(
        current.inner - previous.outer > 0.04,
        `${body.userData.name} overlaps the preceding orbit`,
      );
      previous = current;
    }
  });
});

test("the complete moving mechanism fits inside the tilted hoop with clearance", () => {
  withModel((model) => {
    const centre = model.armillary.getWorldPosition(new THREE.Vector3());
    const p = new THREE.Vector3();
    let inside = Infinity;
    model.ecliptic.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i)
          .applyMatrix4(mesh.matrixWorld)
          .sub(centre);
        inside = Math.min(inside, p.length());
      }
    });
    assert.ok(
      Number.isFinite(inside),
      "the hoop must have physical geometry",
    );
    for (const rotor of model.rotors) {
      const bounds = measure([rotor], centre);
      assert.ok(
        bounds.sphere + 0.05 < inside,
        "a carrier reaches the fixed hoop",
      );
    }
  });
});
