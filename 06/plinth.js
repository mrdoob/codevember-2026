import * as THREE from "three/webgpu";
import { addMesh, annulus, ring } from "./geometry.js";

// Grow the drum downward, then lift the assembly by the same amount. All
// bearings, sleeves and planet clearances keep their original relative layout.
export const BASE_LIFT = 0.18;

export function createPlinth(parent, m) {
  const turn = (p, material) =>
    addMesh(parent, new THREE.LatheGeometry(p.getPoints(8), 192), material);
  turn(
    new THREE.Path()
      .moveTo(0, 0.06 - BASE_LIFT)
      .lineTo(2.89, 0.06 - BASE_LIFT)
      .quadraticCurveTo(3.04, 0.06 - BASE_LIFT, 3.04, 0.16 - BASE_LIFT)
      .lineTo(3.04, 0.872)
      .quadraticCurveTo(3.04, 0.88, 3.035, 0.887)
      .lineTo(2.912, 1.035)
      .quadraticCurveTo(2.904, 1.045, 2.894, 1.045)
      .lineTo(2.46, 1.04)
      .quadraticCurveTo(2.41, 1.04, 2.41, 1.005)
      .lineTo(2.41, 0.925)
      .lineTo(0, 0.925),
    m.base,
  );
  const foot = turn(
    new THREE.Path()
      .moveTo(2.86, 0.095)
      .lineTo(3.035, 0.095)
      .quadraticCurveTo(3.085, 0.095, 3.085, 0.13)
      .lineTo(3.085, 0.25)
      .quadraticCurveTo(3.085, 0.285, 3.035, 0.285)
      .lineTo(2.86, 0.285)
      .lineTo(2.86, 0.095),
    m.brass,
  );
  // Seat the ring's flat underside on the pedestal at world y = 0.
  foot.position.y = -BASE_LIFT - 0.095;
  ring(parent, 3.04, 0.011, m.brass, 0.88);
  ring(parent, 2.904, 0.011, m.brass, 1.044);
  turn(
    new THREE.Path()
      .moveTo(0.185, 0.925)
      .lineTo(2.34, 0.925)
      .quadraticCurveTo(2.39, 0.925, 2.39, 0.945)
      .lineTo(2.39, 1.035)
      .quadraticCurveTo(2.39, 1.06, 2.35, 1.06)
      .lineTo(1.785, 1.06)
      .lineTo(1.77, 1.045)
      .lineTo(1.77, 1.015)
      .lineTo(1.71, 1.015)
      .lineTo(1.71, 1.045)
      .lineTo(1.695, 1.06)
      .lineTo(0.185, 1.06)
      .lineTo(0.185, 0.925),
    m.dial,
  );
  ring(parent, 2.39, 0.014, m.brass, 1.045);
  // The brass lining sits at the bottom of the cut, below its stone walls.
  addMesh(parent, annulus(1.71, 1.77, 0.008), m.brass, 0, 1.019);
  turn(
    new THREE.Path()
      .moveTo(0.185, 1.06)
      .lineTo(0.63, 1.06)
      .lineTo(0.68, 1.105)
      .lineTo(0.68, 1.16)
      .quadraticCurveTo(0.68, 1.19, 0.63, 1.215)
      .lineTo(0.56, 1.24)
      .quadraticCurveTo(0.34, 1.31, 0.3, 1.43)
      .lineTo(0.3, 1.61)
      .lineTo(0.185, 1.61)
      .lineTo(0.185, 1.06),
    m.base,
  );
  ring(parent, 0.675, 0.008, m.brass, 1.115);
  ring(parent, 0.302, 0.01, m.brass, 1.44);
  addMesh(parent, annulus(0.19, 0.32, 0.09, 64, 0.007), m.brass, 0, 1.62);
  addMesh(parent, annulus(0.19, 0.25, 0.1, 64, 0.007), m.brass, 0, 1.77);
  // A stationary hollow housing conceals the concentric rotating sleeves.
  // Its bore clears the outer sleeve; it ends below the lowest moving carrier.
  addMesh(parent, annulus(0.165, 0.19, 1.98, 96), m.pole, 0, 2.6);
  addMesh(parent, annulus(0.165, 0.235, 0.055, 64, 0.004), m.brass, 0, 3.6);
}
