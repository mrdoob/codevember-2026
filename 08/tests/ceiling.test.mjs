import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, MeshBasicMaterial, Box3 } from "three/webgpu";
import { buildCeiling } from "../ceiling.js";
import { CEILING_Y, CEILING_FIXTURE_DEPTH } from "../room-layout.js";

test("the ceiling is flat and all exposed services stay above the fitting boundary", () => {
  const material = new MeshBasicMaterial(),
    meshes = [];
  buildCeiling(
    (geometry, material, position) => {
      const mesh = new Mesh(geometry, material);
      mesh.position.fromArray(position);
      meshes.push(mesh);
      return mesh;
    },
    {
      concrete: material,
      steel: material,
      galvanized: material,
      insulation: material,
      dark: material,
    },
  );
  const bounds = meshes.map((mesh) => {
    mesh.updateMatrixWorld();
    return new Box3().setFromObject(mesh);
  });
  assert.ok(Math.abs(bounds[0].min.y - CEILING_Y) < 1e-6);
  assert.ok(Math.abs(bounds[0].max.y - CEILING_Y - 0.2) < 1e-6);
  for (const box of bounds)
    assert.ok(
      box.min.y >= CEILING_Y - CEILING_FIXTURE_DEPTH,
      `Hanging service reaches ${box.min.y}`,
    );
  for (const mesh of meshes) mesh.geometry.dispose();
  material.dispose();
});
