import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { PLANETS, TAU, orbitAngle } from "./motion.js";
import { addMesh, annulus, consolidate, ring, rod } from "./geometry.js";
import { BASE_LIFT, createPlinth } from "./plinth.js";

const cylinder = (r, h, n = 48) => new THREE.CylinderGeometry(r, r, h, n);

// An arch with flat cut ends: the meridian terminates in mounting shoes
// instead of passing through the top and bottom of the plinth.
function meridianGeometry() {
  const outer = 5.3,
    inner = 5.11,
    bottom = -4.55;
  const a = Math.asin(bottom / outer),
    b = Math.asin(bottom / inner);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, a, Math.PI - a, false);
  shape.lineTo(-Math.sqrt(inner ** 2 - bottom ** 2), bottom);
  shape.absarc(0, 0, inner, Math.PI - b, b, true);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.07,
    bevelEnabled: true,
    bevelThickness: 0.007,
    bevelSize: 0.007,
    bevelSegments: 3,
    curveSegments: 128,
  });
  geometry.translate(0, 0, -0.035);
  return geometry;
}

export function createOrrery(m) {
  const group = new THREE.Group(),
    structure = new THREE.Group();
  group.position.y = BASE_LIFT;
  group.add(structure);
  const plinth = new THREE.Group();
  plinth.scale.set(1.06, 1, 1.06);
  structure.add(plinth);
  createPlinth(plinth, m);
  rod(structure, [0, 1.35, 0], [0, 11.2, 0], 0.026, m.brass);
  addMesh(
    structure,
    new THREE.CapsuleGeometry(0.075, 0.12, 8, 24),
    m.darkMetal,
    0,
    11.15,
  );

  const armillary = new THREE.Group();
  armillary.position.y = 5.8;
  armillary.rotation.y = 0;
  group.add(armillary);
  const meridian = new THREE.Group();
  armillary.add(meridian);
  addMesh(meridian, meridianGeometry(), m.darkMetal);
  for (const side of [-1, 1]) {
    addMesh(
      meridian,
      new RoundedBoxGeometry(0.5, 0.28, 0.3, 4, 0.08),
      m.darkMetal,
      side * 2.52,
      -4.59,
      0,
    );
    const pin = addMesh(
      meridian,
      cylinder(0.12, 0.34, 48),
      m.brass,
      side * 2.52,
      -4.55,
      0,
    );
    pin.rotation.x = Math.PI / 2;
    addMesh(
      meridian,
      new THREE.BoxGeometry(0.085, 0.014, 0.004),
      m.darkMetal,
      side * 2.52,
      -4.55,
      0.173,
    );
  }
  for (let i = 1; i < 12; i++) {
    const a = (i * TAU) / 12;
    rod(
      meridian,
      [Math.sin(a) * 5.04, -Math.cos(a) * 5.04, 0],
      [Math.sin(a) * 5.19, -Math.cos(a) * 5.19, 0],
      0.035,
      m.brass,
    );
  }

  for (let i = 0; i < 180; i++) {
    const a = (i * TAU) / 180;
    if (-Math.cos(a) * 5.2 < -4.5) continue;
    const length = i % 15 === 0 ? 0.12 : 0.045;
    for (const side of [-1, 1]) {
      const tick = addMesh(
        meridian,
        new THREE.BoxGeometry(0.008, length, 0.003),
        m.brass,
        Math.sin(a) * (5.14 + length / 2),
        -Math.cos(a) * (5.14 + length / 2),
        side * 0.044,
      );
      tick.rotation.z = a;
    }
  }

  // Two coaxial trunnions carry the tilted hoop. Its entire inner sphere
  // stays outside the moving mechanism, regardless of its angular position.
  const bearingFrame = new THREE.Group();
  bearingFrame.rotation.z = -0.7;
  armillary.add(bearingFrame);
  const ecliptic = new THREE.Group();
  ecliptic.rotation.y = 0.85;
  bearingFrame.add(ecliptic);
  const hoop = addMesh(ecliptic, annulus(4.98, 5.08, 0.055, 256), m.brass);
  hoop.rotation.x = Math.PI / 2;
  const bearings = new THREE.Group();
  bearingFrame.add(bearings);
  for (const side of [-1, 1]) {
    rod(bearings, [0, side * 5.02, 0], [0, side * 5.26, 0], 0.032, m.brass);
    addMesh(bearings, cylinder(0.135, 0.16, 48), m.brass, 0, side * 5.15);
    addMesh(
      bearings,
      new RoundedBoxGeometry(0.25, 0.28, 0.11, 3, 0.025),
      m.brass,
      0,
      side * 5.1,
      0.065,
    );
    for (const x of [-0.065, 0.065]) {
      const screw = addMesh(
        bearings,
        cylinder(0.029, 0.012, 24),
        m.darkMetal,
        x,
        side * 5.1,
        0.125,
      );
      screw.rotation.x = Math.PI / 2;
    }
  }
  consolidate(meridian);
  consolidate(bearings);

  // The upper counterweight ring is clamped to the fixed central shaft.
  const upper = new THREE.Group();
  upper.position.y = 8.95;
  upper.rotation.x = Math.PI / 2;
  group.add(upper);
  ring(upper, 0.9, 0.014, m.brass);
  for (const y of [8.05, 9.85])
    addMesh(structure, cylinder(0.045, 0.09, 24), m.brass, 0, y);
  const ivory = addMesh(
    structure,
    new THREE.SphereGeometry(0.27, 48, 32),
    m.ivory,
    0,
    8.95,
  );
  ivory.userData.name = "Lunar counterweight";

  const sunGroup = new THREE.Group();
  sunGroup.position.y = 5.55;
  group.add(sunGroup);
  addMesh(sunGroup, new THREE.SphereGeometry(0.72, 64, 48), m.sun);
  addMesh(structure, cylinder(0.12, 0.06), m.brass, 0, 4.84);

  const targets = [],
    planets = [],
    rotors = [];
  for (let i = 0; i < PLANETS.length; i++) {
    const spec = PLANETS[i],
      planetY = spec.height,
      railY = 4.6 - i * 0.22;
    const rotor = new THREE.Group();
    group.add(rotor);
    rotors.push(rotor);
    const carrier = new THREE.Group();
    rotor.add(carrier);

    // Hollow concentric sleeves reach down into the base. Outer sleeves
    // terminate lower, leaving clearance under every inner carrier.
    const inside = 0.036 + i * 0.023,
      outside = inside + 0.02;
    addMesh(
      carrier,
      annulus(inside, outside, railY - 1.25, 64),
      m.pole,
      0,
      (railY + 1.25) / 2,
    );
    addMesh(
      carrier,
      annulus(inside, outside + 0.035, 0.08, 64, 0.006),
      m.brass,
      0,
      railY,
    );
    ring(carrier, spec.orbit, 0.018, m.brass, railY);
    rod(carrier, [outside, railY, 0], [spec.orbit, railY, 0], 0.022, m.brass);
    rod(
      carrier,
      [spec.orbit, railY, 0],
      [spec.orbit, planetY - spec.radius, 0],
      0.018,
      m.brass,
    );
    addMesh(
      carrier,
      cylinder(0.04, 0.055, 24),
      m.brass,
      spec.orbit,
      planetY - spec.radius - 0.02,
    );
    // Shallow brass sockets seat each globe on its carrier stem.
    const socket = [],
      inner = spec.radius + 0.012,
      outer = inner + 0.016;
    for (let j = 0; j <= 12; j++) {
      const a = (0.62 * j) / 12;
      socket.push(
        new THREE.Vector2(outer * Math.sin(a), -outer * Math.cos(a)),
      );
    }
    for (let j = 12; j >= 0; j--) {
      const a = (0.62 * j) / 12;
      socket.push(
        new THREE.Vector2(inner * Math.sin(a), -inner * Math.cos(a)),
      );
    }
    addMesh(
      carrier,
      new THREE.LatheGeometry(socket, 64),
      m.brass,
      spec.orbit,
      planetY,
      0,
    );
    // Two ivory counterweights in the reference, carried on the lamp poles.
    if (spec.name === "Earth" || spec.name === "Jupiter") {
      const y =
        planetY + spec.radius + (spec.name === "Jupiter" ? 0.29 : 0.23);
      rod(
        carrier,
        [spec.orbit, planetY + spec.radius, 0],
        [spec.orbit, y - 0.105, 0],
        0.009,
        m.brass,
      );
      addMesh(
        carrier,
        new THREE.SphereGeometry(0.105, 32, 24),
        m.ivory,
        spec.orbit,
        y,
        0,
      );
    }
    consolidate(carrier);

    const globe = new THREE.Group();
    globe.position.set(spec.orbit, planetY, 0);
    globe.rotation.z = 0.04 + i * 0.03;
    rotor.add(globe);
    const body = addMesh(
      globe,
      new THREE.SphereGeometry(spec.radius, 48, 32),
      m.planets[i],
    );
    body.userData.planet = i;
    body.userData.name = spec.name;
    targets.push(body);
    planets.push({ globe, body, carrier, y: planetY, railY });
    if (spec.name === "Saturn") {
      // Saturn's ring is held by three equatorial struts, with a visible air
      // gap around the sphere. It is part of the same rigid rotating carrier.
      const ringAssembly = new THREE.Group();
      globe.add(ringAssembly);
      addMesh(ringAssembly, annulus(0.54, 0.74, 0.014, 160), m.ivory);
      ring(ringAssembly, 0.56, 0.006, m.brass);
      ring(ringAssembly, 0.735, 0.006, m.brass);
      for (let j = 0; j < 3; j++) {
        const a = (j * TAU) / 3;
        rod(
          ringAssembly,
          [0.486 * Math.cos(a), 0, 0.486 * Math.sin(a)],
          [0.55 * Math.cos(a), 0, 0.55 * Math.sin(a)],
          0.008,
          m.brass,
        );
      }
      consolidate(ringAssembly);
    }
  }
  consolidate(structure);
  function update(clock) {
    rotors.forEach((rotor, i) => {
      rotor.rotation.y = orbitAngle(i, clock);
      planets[i].body.rotation.y = clock * (0.4 + i * 0.08);
    });
    ecliptic.rotation.y = 0.85 + Math.sin(clock * 0.25) * 0.14;
  }
  update(0);
  return {
    group,
    targets,
    planets,
    rotors,
    armillary,
    ecliptic,
    sunGroup,
    update,
    dispose() {
      const geometries = new Set();
      group.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
      });
      geometries.forEach((g) => g.dispose());
    },
  };
}
