import * as THREE from 'three/webgpu';
import Box3D from 'box3d.js/inline';
import { randomGenerator } from './fracture.js';

const b3 = await Box3D();
const STEP = 1 / 240, SUBSTEPS = 4;
const SCALE = 10; // Internal length units tighten contact tolerances for small shards.
const DENSITY = 2500; // kg/m³; scene units are metres.
const idKey = id => `${id.index1}:${id.generation}`;
const v = [0, 0, 0], q = [0, 0, 0, 1];
const readVector = (getter, body, scale = 1) => new THREE.Vector3().fromArray(getter(v, body.id)).multiplyScalar(scale);
const centerOfMass = body => readVector(b3.b3Body_GetWorldCenterOfMass, body, 1 / SCALE);
const linearVelocity = body => readVector(b3.b3Body_GetLinearVelocity, body, 1 / SCALE);
const angularVelocity = body => readVector(b3.b3Body_GetAngularVelocity, body);

function angularMomentumAbout(body, point) {
  const rotation = new THREE.Quaternion().fromArray(b3.b3Body_GetRotation(q, body.id));
  const omega = angularVelocity(body).applyQuaternion(rotation.clone().invert());
  const { cx, cy, cz } = body.inertia;
  const momentum = new THREE.Vector3(
    cx[0] * omega.x + cy[0] * omega.y + cz[0] * omega.z,
    cx[1] * omega.x + cy[1] * omega.y + cz[1] * omega.z,
    cx[2] * omega.x + cy[2] * omega.y + cz[2] * omega.z
  ).applyQuaternion(rotation);
  return momentum.add(centerOfMass(body).sub(point).cross(linearVelocity(body).multiplyScalar(body.mass)));
}

export function kineticEnergy(body) {
  const rotation = new THREE.Quaternion().fromArray(b3.b3Body_GetRotation(q, body.id));
  const omega = angularVelocity(body).applyQuaternion(rotation.invert());
  const { cx, cy, cz } = body.inertia;
  const angularMomentum = new THREE.Vector3(
    cx[0] * omega.x + cy[0] * omega.y + cz[0] * omega.z,
    cx[1] * omega.x + cy[1] * omega.y + cz[1] * omega.z,
    cx[2] * omega.x + cy[2] * omega.y + cz[2] * omega.z
  );
  return 0.5 * body.mass * linearVelocity(body).lengthSq() + 0.5 * omega.dot(angularMomentum);
}

export class ShatterSimulation {
  constructor(onImpact = () => {}) {
    this.engine = 'Box3D';
    this.onImpact = onImpact; this.bodies = []; this.serial = 0; this.time = 0; this.accumulator = 0;
    const def = b3.b3DefaultWorldDef();
    def.gravity = [0, -9.81 * SCALE, 0]; def.enableContinuous = true;
    def.hitEventThreshold = 0.2 * SCALE; def.restitutionThreshold = SCALE;
    def.contactHertz = 120; def.contactDampingRatio = 1; def.contactSpeed = 10 * SCALE;
    this.world = b3.b3CreateWorld(def);
    this.events = b3.createEventsBuffer();
    this.hitEvent = b3.createContactHitEvent(); this.touchEvent = b3.createContactTouchEvent();
    this.intactColliders = new Map(); this.dynamicShapes = new Set(); this.hulls = new Map(); this.hadShardContact = false;
    const groundDef = b3.b3DefaultBodyDef(); groundDef.position = [0, 0, 0];
    this.ground = b3.b3CreateBody(this.world, groundDef);
    const shape = b3.b3DefaultShapeDef(); shape.baseMaterial.friction = 0.6; shape.baseMaterial.restitution = 0.12;
    groundDef.position = [0, -0.5 * SCALE, 0];
    b3.b3Body_SetTransform(this.ground, groundDef.position, [0, 0, 0, 1]);
    b3.b3CreateBoxShape(this.ground, shape, 100 * SCALE, 0.5 * SCALE, 100 * SCALE);
  }
  moveGround(x, z) {
    // Recenter only occasionally; moving a static collider every frame would
    // unnecessarily invalidate contacts beneath the sleeping trail.
    const previous = this.groundCenter || [0, 0];
    if (Math.hypot(x - previous[0], z - previous[1]) < 25) return;
    this.groundCenter = [x, z];
    b3.b3Body_SetTransform(this.ground, [x * SCALE, -0.5 * SCALE, z * SCALE], [0, 0, 0, 1]);
  }
  get counts() { const c = b3.b3World_GetCounters(this.world); return { bodies: c.bodyCount - 1, colliders: c.shapeCount, contacts: c.contactCount }; }
  createBody(position, quaternion) {
    const def = b3.b3DefaultBodyDef(); def.type = b3.b3BodyType.b3_dynamicBody;
    def.position = position.toArray().map(n => n * SCALE); def.rotation = quaternion.toArray();
    def.isBullet = true; def.sleepThreshold = 0.05 * SCALE; def.enableContactRecycling = false; def.linearDamping = 0.015; def.angularDamping = 0.03;
    return { id: b3.b3CreateBody(this.world, def), colliders: [], mass: 0, inertia: null };
  }
  applyMass(body) {
    b3.b3Body_ApplyMassFromShapes(body.id);
    body.mass = b3.b3Body_GetMass(body.id);
    body.inertia = Object.fromEntries(Object.entries(b3.b3Body_GetLocalRotationalInertia(body.id)).map(([key, column]) => [key, column.map(n => n / (SCALE * SCALE))]));
  }
  setVelocity(body, velocity, angular) {
    b3.b3Body_SetLinearVelocity(body.id, velocity.toArray().map(n => n * SCALE)); b3.b3Body_SetAngularVelocity(body.id, angular.toArray());
  }
  addColliders(body, fragment, offset = new THREE.Vector3(), intact = null) {
    const first = body.colliders.length;
    const def = b3.b3DefaultShapeDef(); def.density = DENSITY / SCALE ** 3;
    def.baseMaterial.friction = 0.52; def.baseMaterial.restitution = 0.16;
    def.enableHitEvents = !!intact; def.enableContactEvents = true; def.updateBodyMass = false;
    for (const points of fragment.collisionParts) {
      if (!this.hulls.has(points)) {
        const hull = b3.b3CreateHull(points.map(n => n * SCALE));
        if (!hull) throw new Error('Invalid convex fracture cell');
        this.hulls.set(points, hull);
      }
      const hull = this.hulls.get(points);
      const collider = b3.b3CreateTransformedHullShape(body.id, def, hull, { position: offset.toArray().map(n => n * SCALE), quaternion: [0, 0, 0, 1] }, [1, 1, 1]);
      body.colliders.push(collider); this.dynamicShapes.add(idKey(collider));
      if (intact) this.intactColliders.set(idKey(collider), intact);
    }
    return body.colliders.slice(first);
  }
  drop(shards, { height = 5.8, spread = 0.22, toughness = 1.2, fractureDelay = 0.002, x = 0, z = 0, rotation = null, angularVelocity = null } = {}) {
    const random = randomGenerator(++this.serial * 1237);
    const body = {
      position: new THREE.Vector3(x, height, z), quaternion: new THREE.Quaternion().setFromEuler(rotation || new THREE.Euler(random() * 0.65, random() * 2, random() * 0.65)),
      velocity: new THREE.Vector3((random() - 0.5) * 0.5, -0.3, (random() - 0.5) * 0.5), angular: angularVelocity ? angularVelocity.clone() : new THREE.Vector3(0.22, 0.3, -0.15),
      broken: false, fracturing: false, age: 0, spread: THREE.MathUtils.clamp(spread, 0, 0.5), toughness,
      fractureDelay: THREE.MathUtils.clamp(fractureDelay, 0, 0.5),
      fragments: shards.map(s => ({ ...s, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angular: new THREE.Vector3(), sleeping: false, released: false, rigidBody: null }))
    };
    body.rigidBody = this.createBody(body.position, body.quaternion);
    for (const f of body.fragments) f.attachedColliders = this.addColliders(body.rigidBody, f, f.center, body);
    this.applyMass(body.rigidBody); this.setVelocity(body.rigidBody, body.velocity, body.angular);
    this.bodies.push(body); this.placeIntact(body); return body;
  }
  placeIntact(body) {
    for (const f of body.fragments) {
      if (f.released) continue;
      f.position.copy(f.center).applyQuaternion(body.quaternion).add(body.position); f.quaternion.copy(body.quaternion);
    }
  }
  readRigidBody(target) {
    const id = target.rigidBody.id;
    target.position.fromArray(b3.b3Body_GetPosition(v, id)).divideScalar(SCALE); target.quaternion.fromArray(b3.b3Body_GetRotation(q, id));
    target.velocity.fromArray(b3.b3Body_GetLinearVelocity(v, id)).divideScalar(SCALE); target.angular.fromArray(b3.b3Body_GetAngularVelocity(v, id));
    target.sleeping = !b3.b3Body_IsAwake(id);
  }
  bottom(fragment) {
    let min = Infinity;
    for (const p of fragment.support) min = Math.min(min, p.clone().applyQuaternion(fragment.quaternion).y);
    return fragment.position.y + min;
  }
  // Exact unilateral plane contact supplements Box3D's soft contacts in
  // dense piles. Position correction stays in the solver; a contact impulse
  // uses its actual world inverse inertia, so corners produce proper torque.
  guardFloor(rigidBody, fragments) {
    let bottom = -0.0005; const point = new THREE.Vector3(), vertex = new THREE.Vector3();
    for (const f of fragments) {
      const bounds = f.geometry.boundingSphere;
      if (vertex.copy(bounds.center).applyQuaternion(f.quaternion).add(f.position).y > bounds.radius) continue;
      for (const local of f.support) {
        vertex.copy(local).applyQuaternion(f.quaternion).add(f.position);
        if (vertex.y < bottom) { bottom = vertex.y; point.copy(vertex); }
      }
    }
    if (bottom >= -0.0005) return null;
    const worldPoint = point.toArray().map(n => n * SCALE);
    const contactVelocity = b3.b3Body_GetWorldPointVelocity([0, 0, 0], rigidBody.id, worldPoint);
    const approachSpeed = Math.max(0, -contactVelocity[1] / SCALE);
    const origin = b3.b3Body_GetPosition([0, 0, 0], rigidBody.id);
    const rotation = b3.b3Body_GetRotation([0, 0, 0, 1], rigidBody.id);
    const correction = (-bottom + 0.0001) * SCALE;
    origin[1] += correction; worldPoint[1] += correction;
    b3.b3Body_SetTransform(rigidBody.id, origin, rotation);
    if (contactVelocity[1] < 0) {
      const com = b3.b3Body_GetWorldCenterOfMass([0, 0, 0], rigidBody.id);
      const rx = worldPoint[0] - com[0], rz = worldPoint[2] - com[2];
      const { cx, cz } = b3.b3Body_GetWorldInverseRotationalInertia(rigidBody.id);
      // r × n = (-rz, 0, rx), with n = (0, 1, 0).
      const inverseEffectiveMass = 1 / rigidBody.mass + rz * rz * cx[0] - rx * rz * (cz[0] + cx[2]) + rx * rx * cz[2];
      const restitution = approachSpeed > 1 ? 0.16 : 0;
      const impulse = -(1 + restitution) * contactVelocity[1] / Math.max(inverseEffectiveMass, 1e-12);
      b3.b3Body_ApplyLinearImpulse(rigidBody.id, [0, impulse, 0], worldPoint, true);
    }
    point.y = 0;
    return { point, approachSpeed };
  }
  destroyBody(body) {
    for (const shape of body.colliders) { this.intactColliders.delete(idKey(shape)); this.dynamicShapes.delete(idKey(shape)); }
    b3.b3DestroyBody(body.id);
  }
  break(body, point) {
    if (body.broken) return;
    const parent = body.rigidBody;
    const postEnergy = kineticEnergy(parent);
    body.broken = true; body.fracturing = true; body.brokenAt = this.time; body.impactPoint = point.clone();
    this.readRigidBody(body); this.placeIntact(body);
    for (const f of body.fragments) {
      // Freeze the order in world space at impact; later tumbling cannot
      // reverse the wave or postpone a fragment that was already scheduled.
      f.impactHeight = f.position.y;
    }
    const low = Math.min(...body.fragments.map(f => f.impactHeight));
    const high = Math.max(...body.fragments.map(f => f.impactHeight));
    for (const f of body.fragments) {
      f.releaseAt = this.time + (high - low > 1e-6 ? (f.impactHeight - low) / (high - low) * body.fractureDelay : 0);
    }
    body.fractureStats = { massBefore: parent.mass, massAfter: 0,
      releaseBudget: Math.max(0, body.preImpactEnergy - postEnergy) * body.spread,
      releasedEnergy: 0, releases: [] };
    this.releaseFragments(body);
    this.onImpact(body);
  }
  releaseFragments(body) {
    const batch = body.fragments.filter(f => !f.released && f.releaseAt <= this.time + 1e-10);
    if (!batch.length) return;
    const parent = body.rigidBody, stats = body.fractureStats;
    const energyBefore = kineticEnergy(parent), com = centerOfMass(parent);
    const velocity = linearVelocity(parent), omega = angularVelocity(parent), massBefore = parent.mass;
    const angularMomentumBefore = angularMomentumAbout(parent, com);
    this.readRigidBody(body); this.placeIntact(body);
    // Detach actual collider volumes. The remaining compound keeps its
    // collisions, inertia, and motion throughout the propagation interval.
    const detached = new Set();
    for (const f of batch) {
      for (const collider of f.attachedColliders) {
        const key = idKey(collider);
        detached.add(key); this.intactColliders.delete(key); this.dynamicShapes.delete(key);
        b3.b3DestroyShape(collider, false);
      }
      f.attachedColliders = [];
    }
    parent.colliders = parent.colliders.filter(collider => !detached.has(idKey(collider)));
    const parts = [];
    if (parent.colliders.length) {
      this.applyMass(parent);
      parts.push({ rigidBody: parent, release: new THREE.Vector3() });
    } else {
      this.destroyBody(parent); body.rigidBody = null;
      body.fracturing = false; body.fractureCompletedAt = this.time;
    }
    let detachedMass = 0;
    for (const f of batch) {
      f.rigidBody = this.createBody(f.position, f.quaternion);
      this.addColliders(f.rigidBody, f); this.applyMass(f.rigidBody);
      f.released = true; f.releasedAt = this.time;
      detachedMass += f.rigidBody.mass;
      const offset = centerOfMass(f.rigidBody).sub(com);
      parts.push({ rigidBody: f.rigidBody, release: offset.clone().multiplyScalar(1 / Math.max(0.3, offset.length())) });
    }
    let totalMass = 0; const mean = new THREE.Vector3();
    for (const part of parts) {
      const offset = centerOfMass(part.rigidBody).sub(com);
      part.velocity = velocity.clone().add(omega.clone().cross(offset));
      this.setVelocity(part.rigidBody, part.velocity, omega);
      totalMass += part.rigidBody.mass; mean.addScaledVector(part.release, part.rigidBody.mass);
    }
    // Include the attached remainder in the reaction, preserving linear and
    // angular momentum at each split rather than injecting an outward kick.
    mean.divideScalar(totalMass);
    let unitEnergy = 0, crossEnergy = 0;
    for (const part of parts) {
      part.release.sub(mean);
      unitEnergy += 0.5 * part.rigidBody.mass * part.release.lengthSq();
      crossEnergy += part.rigidBody.mass * part.velocity.dot(part.release);
    }
    const allocation = stats.releaseBudget * detachedMass / stats.massBefore;
    const baseEnergy = parts.reduce((sum, p) => sum + kineticEnergy(p.rigidBody), 0);
    const available = Math.max(0, Math.min(allocation, energyBefore + allocation - baseEnergy));
    const speed = unitEnergy > 1e-9 ? Math.max(0, (-crossEnergy + Math.sqrt(crossEnergy ** 2 + 4 * unitEnergy * available)) / (2 * unitEnergy)) : 0;
    for (const part of parts) this.setVelocity(part.rigidBody, part.velocity.addScaledVector(part.release, speed), omega);
    const energyAfter = parts.reduce((sum, p) => sum + kineticEnergy(p.rigidBody), 0);
    const momentumAfter = parts.reduce((sum, p) => sum.addScaledVector(linearVelocity(p.rigidBody), p.rigidBody.mass), new THREE.Vector3());
    const angularMomentumAfter = parts.reduce((sum, p) => sum.add(angularMomentumAbout(p.rigidBody, com)), new THREE.Vector3());
    stats.massAfter += detachedMass; stats.releasedEnergy += Math.max(0, energyAfter - baseEnergy);
    stats.releases.push({ time: this.time, count: batch.length, massBefore, massAfter: totalMass,
      momentumBefore: velocity.clone().multiplyScalar(massBefore), momentumAfter, angularMomentumBefore, angularMomentumAfter,
      energyBefore, energyAfter, allocation });
  }
  update(delta) {
    this.accumulator += Math.max(0, Math.min(delta, 0.1));
    while (this.accumulator + 1e-10 >= STEP) { this.step(); this.accumulator -= STEP; }
  }
  step() {
    this.time += STEP;
    for (const body of this.bodies) { body.age += STEP; if (!body.broken) body.preImpactEnergy = kineticEnergy(body.rigidBody); }
    b3.b3World_Step(this.world, STEP, SUBSTEPS); b3.getEvents(this.events, this.world);
    const impacts = new Map();
    for (const body of this.bodies) {
      if (body.rigidBody) {
        this.readRigidBody(body); this.placeIntact(body);
        const contact = this.guardFloor(body.rigidBody, body.fragments.filter(f => !f.released));
        if (!body.broken && contact && contact.approachSpeed >= body.toughness) impacts.set(body, contact.point);
      }
      for (const f of body.fragments) if (f.rigidBody) {
        this.readRigidBody(f); this.guardFloor(f.rigidBody, [f]);
      }
    }
    for (let i = 0; i < b3.getNumContactHitEvents(this.events); i++) {
      const event = b3.getContactHitEventAt(this.hitEvent, this.events, i);
      for (const shape of [event.shapeIdA, event.shapeIdB]) {
        const body = this.intactColliders.get(idKey(shape));
        if (body && !body.broken && event.approachSpeed >= body.toughness * SCALE) impacts.set(body, new THREE.Vector3().fromArray(event.point).divideScalar(SCALE));
      }
    }
    for (let i = 0; i < b3.getNumContactBeginEvents(this.events); i++) {
      const event = b3.getContactBeginEventAt(this.touchEvent, this.events, i);
      if (this.dynamicShapes.has(idKey(event.shapeIdA)) && this.dynamicShapes.has(idKey(event.shapeIdB))) this.hadShardContact = true;
    }
    for (const [body, point] of impacts) this.break(body, point);
    for (const body of this.bodies) {
      if (body.fracturing) this.releaseFragments(body);
      if (body.rigidBody) { this.readRigidBody(body); this.placeIntact(body); }
      for (const f of body.fragments) if (f.rigidBody) this.readRigidBody(f);
    }
  }
  remove(body) {
    if (body.rigidBody) this.destroyBody(body.rigidBody);
    for (const f of body.fragments) if (f.rigidBody) this.destroyBody(f.rigidBody);
    const index = this.bodies.indexOf(body); if (index >= 0) this.bodies.splice(index, 1);
  }
  clear() { for (const body of [...this.bodies]) this.remove(body); this.accumulator = 0; this.time = 0; this.serial = 0; this.hadShardContact = false; }
  dispose() { this.clear(); b3.destroyEventsBuffer(this.events); b3.b3DestroyWorld(this.world); for (const hull of this.hulls.values()) b3.b3DestroyHull(hull); this.hulls.clear(); }
}
