import Box3D from "box3d.js/inline";
import {
  LINK,
  LINK_PITCH,
  rotateVector,
  colliderPath,
  linkPoint,
  alignY,
  multiplyQuaternion,
} from "./link-shape.js";

export const b3 = await Box3D();
// Keep the narrow capsule stock well above the solver's collision tolerances.
// Positions/velocities enter Box3D at 10× scale; density and reported forces
// are converted back to scene units.
export const SCALE = 10;
export const STEP = 1 / 120;
export const LINK_COUNT = 19;
export const CENTER_LINK = (LINK_COUNT - 1) / 2;
export const BREAKABLE_LINKS = Array.from({ length: 9 }, (_, i) => i + 5);
export const CUT =
  (Math.PI * LINK.bend + LINK.halfStraight) /
  (2 * Math.PI * LINK.bend + 4 * LINK.halfStraight);
const fullPath = colliderPath(10);
// A branch passes through the side of an ordinary link in the main chain.
const ATTACHMENT_PITCH =
  2 * LINK.bend + LINK.halfStraight - 2 * LINK.tube - 0.006;
const normalize = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function frameY(direction, normal) {
  const axis = normalize(direction),
    q = alignY(axis),
    current = rotateVector([0, 0, 1], q);
  const target = normalize(
    normal.map((v, k) => v - axis[k] * dot(normal, axis)),
  );
  const angle = Math.atan2(
    dot(cross(current, target), axis),
    dot(current, target),
  );
  return multiplyQuaternion(q, [
    0,
    Math.sin(angle / 2),
    0,
    Math.cos(angle / 2),
  ]);
}
const scaled = (p) => p.map((v) => v * SCALE);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export function halfPath(half) {
  return Array.from({ length: 19 }, (_, i) =>
    linkPoint(CUT + half * 0.5 + (i / 18) * 0.5),
  );
}

export class TensionSimulation {
  constructor({
    angle = 0.42,
    seed = 0,
    strength = 35000,
    weakLink = null,
    chooseBreakLink = null,
    chainCount = 1,
    fractureMode = "snap",
    layout = "chain",
  } = {}) {
    this.underwater = layout === "mine";
    const def = b3.b3DefaultWorldDef();
    def.gravity = [0, -1.4 * SCALE, 0];
    def.enableContinuous = true;
    def.contactHertz = 120;
    def.contactDampingRatio = 1;
    def.contactSpeed = 4 * SCALE;
    this.world = b3.b3CreateWorld(def);
    this.angle = angle;
    const lean = 0.16 + Math.sin(seed * 1.9) * 0.1;
    this.axis = [
      Math.cos(angle) * Math.cos(lean),
      Math.sin(angle) * Math.cos(lean),
      Math.sin(lean),
    ];
    this.seed = seed;
    this.chainCount = Math.max(1, Math.min(3, chainCount));
    this.fractureMode = fractureMode;
    this.chains = [];
    this.anchors = [];
    this.edges = [];
    this.drawVelocity = 0;
    this.lastPull = 0;
    this.tugAge = 10;
    this.hinge = null;
    this.weakLink = weakLink;
    this.forcedWeakLink = weakLink;
    this.chooseBreakLink = chooseBreakLink;
    this.strength = strength;
    this.links = [];
    this.fragments = [];
    this.time = 0;
    this.accumulator = 0;
    this.extension = 0;
    this.load = 0;
    this.broken = false;
    this.anchorsReleased = false;
    this.fracture = null;
    this.fractures = [];
    this.pendingFracture = null;
    this.sinceBreak = 0;
    // A circular arc keeps neighboring centers exactly one link pitch apart.
    // The middle opening stays at the origin for the camera's incoming pass.
    const up = this.axis.map((v, k) => (k === 1 ? 1 : 0) - v * this.axis[1]);
    const upLength = Math.hypot(...up);
    for (let k = 0; k < 3; k++) up[k] /= upLength;
    const arcAngle = 1.4 + 0.08 * Math.sin(seed * 2.3);
    const firstPitch = LINK_PITCH;
    const radius = ((CENTER_LINK - 1) * LINK_PITCH + firstPitch) / arcAngle;
    const firstStep = 2 * Math.asin(firstPitch / (2 * radius));
    const regularStep = 2 * Math.asin(LINK_PITCH / (2 * radius));
    const totalAngle = firstStep + (CENTER_LINK - 1) * regularStep;
    this.span = radius * Math.sin(totalAngle);
    this.tautSpan = (CENTER_LINK - 1) * LINK_PITCH + firstPitch;
    this.slack = this.tautSpan - this.span;
    this.anchorOffset = up.map((v) => v * radius * (1 - Math.cos(totalAngle)));
    const hanging = [0, -1.5, 0];
    for (let i = 0; i < LINK_COUNT; i++) {
      const distance = Math.abs(i - CENTER_LINK);
      const a =
        Math.sign(i - CENTER_LINK) *
        (distance ? firstStep + (distance - 1) * regularStep : 0);
      let p = this.axis.map(
        (v, k) => radius * (v * Math.sin(a) + up[k] * (1 - Math.cos(a))),
      );
      let frame = alignY(
        this.axis.map((v, k) => v * Math.cos(a) + up[k] * Math.sin(a)),
      );
      if (layout === "mine") {
        const a = 0.68 * Math.cos((i / (LINK_COUNT - 1)) * Math.PI);
        const heading = seed * 1.7 + 0.25;
        const tangent = [
          Math.sin(a) * Math.cos(heading),
          -Math.cos(a),
          Math.sin(a) * Math.sin(heading),
        ];
        if (i)
          for (let k = 0; k < 3; k++) hanging[k] += tangent[k] * LINK_PITCH;
        p = [...hanging];
        frame = alignY(tangent);
      }
      const twist = (((i - CENTER_LINK) % 2) * Math.PI) / 2 + 0.16;
      const q = multiplyQuaternion(frame, [
        0,
        Math.sin(twist / 2),
        0,
        Math.cos(twist / 2),
      ]);
      const body = this.createBody(p, q, fullPath, true);
      body.chain = 0;
      this.links.push(body);
      if (i > 0) this.edges.push([i - 1, i, LINK_PITCH]);
    }
    this.chains.push(Array.from({ length: LINK_COUNT }, (_, i) => i));
    for (const [index, sign] of [
      [0, -1],
      [LINK_COUNT - 1, 1],
    ])
      this.anchors.push({
        index,
        base: [...this.links[index].position],
        direction: this.axis.map((v) => v * sign),
        slack: this.slack,
        load: 0,
      });
    for (let branch = 0; branch < this.chainCount - 1; branch++) {
      const rootIndex =
          layout === "mine"
            ? branch === 0
              ? 2
              : 4
            : CENTER_LINK + (branch === 0 ? -2 : 2),
        root = this.links[rootIndex];
      const normal = rotateVector([0, 0, 1], root.quaternion);
      const sign = branch === 0 ? 1 : -1,
        direction = rotateVector([sign, 0, 0], root.quaternion);
      const gravity = [0, -1, 0];
      const bow = normalize(
        gravity.map(
          (v, k) =>
            v -
            direction[k] * dot(gravity, direction) +
            normal[k] * (branch === 0 ? -0.35 : 0.35),
        ),
      );
      const count = 9,
        length = ATTACHMENT_PITCH + (count - 1) * LINK_PITCH,
        radius = length / 1.25;
      const first = 2 * Math.asin(ATTACHMENT_PITCH / (2 * radius)),
        increment = 2 * Math.asin(LINK_PITCH / (2 * radius));
      const chain = [rootIndex];
      for (let i = 0; i < count; i++) {
        const a = first + i * increment;
        const position = direction.map(
          (v, k) =>
            root.position[k] +
            radius * (v * Math.sin(a) + bow[k] * (1 - Math.cos(a))),
        );
        const tangent = direction.map(
          (v, k) => v * Math.cos(a) + bow[k] * Math.sin(a),
        );
        const frame = frameY(tangent, normal),
          twist = i % 2 === 0 ? Math.PI / 2 : 0;
        const q = multiplyQuaternion(frame, [
          0,
          Math.sin(twist / 2),
          0,
          Math.cos(twist / 2),
        ]);
        const index = this.links.length,
          body = this.createBody(position, q, fullPath, true);
        body.chain = branch + 1;
        this.links.push(body);
        this.edges.push([
          chain.at(-1),
          index,
          i === 0 ? ATTACHMENT_PITCH : LINK_PITCH,
        ]);
        chain.push(index);
      }
      const endpoint = this.links[chain.at(-1)].position;
      const offset = endpoint.map((v, k) => v - root.position[k]);
      this.anchors.push({
        index: chain.at(-1),
        base: [...endpoint],
        direction: normalize(offset),
        slack: length - Math.hypot(...offset),
        rootIndex,
        rootOrigin: [...root.position],
        load: 0,
      });
      this.chains.push(chain);
    }
    this.breakableLinks = [
      ...(layout === "mine" && this.chainCount === 1
        ? this.chains[0].slice(1, -1)
        : BREAKABLE_LINKS),
      ...this.chains.slice(1).flatMap((chain) => chain.slice(1, 5)),
    ];
    if (weakLink !== null && !this.breakableLinks.includes(weakLink)) {
      this.dispose();
      throw new RangeError("Invalid weak link");
    }
    this.updateLoadPaths();
  }
  get slackRemaining() {
    return Math.max(0, this.slack - this.extension);
  }
  updateLoadPaths() {
    // Find the remaining paths between pulling points. Dangling tails cannot
    // carry tension; prune them without removing any of their physical bodies.
    const adjacency = new Map();
    this.links.forEach((body, i) => {
      if (body) adjacency.set(i, new Set());
    });
    for (const [a, b] of this.edges)
      if (adjacency.has(a) && adjacency.has(b)) {
        adjacency.get(a).add(b);
        adjacency.get(b).add(a);
      }
    const visited = new Set();
    this.loadedComponents = [];
    for (const start of adjacency.keys()) {
      if (visited.has(start)) continue;
      const component = new Set(),
        stack = [start];
      while (stack.length) {
        const i = stack.pop();
        if (visited.has(i)) continue;
        visited.add(i);
        component.add(i);
        stack.push(...adjacency.get(i));
      }
      const anchors = this.anchors.filter((a) => component.has(a.index));
      if (anchors.length < 2) continue;
      const terminals = new Set(anchors.map((a) => a.index));
      const leaves = [...component].filter(
        (i) => adjacency.get(i).size < 2 && !terminals.has(i),
      );
      while (leaves.length) {
        const i = leaves.pop();
        component.delete(i);
        for (const neighbor of adjacency.get(i)) {
          adjacency.get(neighbor).delete(i);
          if (adjacency.get(neighbor).size < 2 && !terminals.has(neighbor))
            leaves.push(neighbor);
        }
        adjacency.get(i).clear();
      }
      this.loadedComponents.push({ links: component, anchors, load: 0 });
    }
    this.focusedComponent =
      this.loadedComponents.find((c) =>
        c.anchors.some((a) => a.index === this.focusAnchor),
      ) ?? this.loadedComponents[0];
    this.focusAnchor = this.focusedComponent?.anchors[0].index;
    this.loadedLinks = new Set(
      this.loadedComponents.flatMap((c) => [...c.links]),
    );
    this.eligibleLinks = this.breakableLinks.filter((i) =>
      this.loadedLinks.has(i),
    );
    if (this.fractures.length)
      for (const component of this.loadedComponents) {
        const mounts = component.anchors.map(
          (a) => a.target ?? this.links[a.index].position,
        );
        const center = [0, 1, 2].map(
          (k) => mounts.reduce((sum, p) => sum + p[k], 0) / mounts.length,
        );
        component.anchors.forEach((anchor, i) => {
          // Continue from the same mount positions, now pulling apart the ends
          // of each surviving path instead of dragging both ends together.
          anchor.continuation = {
            base: [...mounts[i]],
            extension: this.extension,
          };
          anchor.direction = normalize(mounts[i].map((v, k) => v - center[k]));
        });
      }
    for (const anchor of this.anchors) {
      anchor.engaged = this.loadedComponents.some((c) =>
        c.anchors.includes(anchor),
      );
      if (!anchor.engaged && this.loadedComponents.length)
        anchor.releaseTime ??= this.time + 0.65;
    }
  }
  get failureCandidates() {
    if (!this.fractures.length) return this.eligibleLinks;
    const loaded = new Set(
      this.loadedComponents
        .filter((c) => c.load > this.strength * 0.9)
        .flatMap((c) => [...c.links]),
    );
    return this.eligibleLinks.filter((i) => loaded.has(i));
  }
  focusPoint() {
    const indices = this.eligibleLinks.filter(
      (i) =>
        this.links[i] &&
        (!this.focusedComponent || this.focusedComponent.links.has(i)),
    );
    if (!indices.length)
      return this.fracture?.position ?? this.links[CENTER_LINK].position;
    return [0, 1, 2].map((k) => {
      const values = indices.map((i) => this.links[i].position[k]);
      return (Math.min(...values) + Math.max(...values)) / 2;
    });
  }
  createBody(position, quaternion, path, closed, shape = LINK, mass = null) {
    const bd = b3.b3DefaultBodyDef();
    bd.type = b3.b3BodyType.b3_dynamicBody;
    bd.position = scaled(position);
    bd.rotation = quaternion;
    bd.isBullet = true;
    bd.linearDamping = this.underwater ? 0.7 : 0.12;
    bd.angularDamping = this.underwater ? 2 : 0.25;
    bd.enableSleep = false;
    const id = b3.b3CreateBody(this.world, bd);
    const sd = b3.b3DefaultShapeDef();
    let volume = 0;
    for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
      const length =
        Math.hypot(
          ...path[i].map((v, k) => v - path[(i + 1) % path.length][k]),
        ) * SCALE;
      const radius = shape.tube * SCALE;
      volume +=
        Math.PI * radius * radius * length + (4 / 3) * Math.PI * radius ** 3;
    }
    sd.density = mass === null ? 7800 / SCALE ** 3 : mass / volume;
    sd.baseMaterial.friction = 0.32;
    sd.baseMaterial.restitution = this.underwater ? 0 : 0.03;
    sd.updateBodyMass = false;
    for (let j = 0; j < path.length - (closed ? 0 : 1); j++) {
      b3.b3CreateCapsuleShape(id, sd, {
        center1: scaled(path[j]),
        center2: scaled(path[(j + 1) % path.length]),
        radius: shape.tube * SCALE,
      });
    }
    b3.b3Body_ApplyMassFromShapes(id);
    return {
      id,
      position: [...position],
      quaternion: [...quaternion],
      previousPosition: [...position],
      previousQuaternion: [...quaternion],
      mass: b3.b3Body_GetMass(id),
      velocity: [0, 0, 0],
    };
  }
  step(pull = 1) {
    for (const link of [...this.links, ...this.fragments, this.mine])
      if (link) {
        for (let k = 0; k < 3; k++) link.previousPosition[k] = link.position[k];
        for (let k = 0; k < 4; k++)
          link.previousQuaternion[k] = link.quaternion[k];
      }
    if (Math.abs(pull - this.lastPull) > 0.2 && this.extension > 0.02)
      this.tugAge = 0;
    this.lastPull = pull;
    this.tugAge += STEP;
    if (!this.broken) {
      const rate =
        (this.fractures.length ? 0.45 : 0.1) +
        0.5 * Math.min(1, this.slackRemaining / 0.12);
      const engagement = Math.max(0, Math.min(1, (this.time - 1.2) / 1.3));
      const wanted =
        pull > 0
          ? pull * rate * engagement
          : -Math.min(1.6, this.extension * 3.5);
      this.drawVelocity +=
        (wanted - this.drawVelocity) * (1 - Math.exp(-STEP * 10));
      this.extension = Math.max(0, this.extension + this.drawVelocity * STEP);
      if (this.extension === 0) this.drawVelocity = 0;
    } else this.sinceBreak += STEP;
    const takeUp = Math.min(1, this.extension / this.slack),
      excess = Math.max(0, this.extension - this.slack);
    const pulse =
      Math.sin(this.tugAge * 30) * Math.exp(-this.tugAge * 10) * 0.065;
    for (const anchor of this.anchors) {
      if (this.anchorsReleased) break;
      if (anchor.passive) continue;
      if (anchor.joint) {
        anchor.load =
          Math.hypot(
            ...b3.b3Joint_GetConstraintForce([0, 0, 0], anchor.joint),
          ) / SCALE;
        continue;
      }
      if (this.time > anchor.releaseTime) {
        anchor.load = 0;
        continue;
      }
      const body = this.links[anchor.index];
      const travel =
        takeUp * anchor.slack +
        excess +
        (this.broken ? Math.min(this.sinceBreak * 0.8, 2.6) : 0);
      // Once a link fails, keep the mounts fixed while surviving paths reload.
      if (
        !this.fractures.length &&
        anchor.rootIndex !== undefined &&
        this.links[anchor.rootIndex]
      )
        anchor.rootLast = [...this.links[anchor.rootIndex].position];
      const root = anchor.rootLast ?? null;
      const target =
        anchor.externalTarget ??
        (anchor.continuation
          ? anchor.continuation.base.map(
              (v, k) =>
                v +
                anchor.direction[k] *
                  (this.extension -
                    anchor.continuation.extension +
                    (this.broken ? Math.min(this.sinceBreak * 0.8, 2.6) : 0)),
            )
          : anchor.base.map(
              (v, k) =>
                v +
                (root ? root[k] - anchor.rootOrigin[k] : 0) +
                anchor.direction[k] * travel +
                (k === 2 ? pulse : 0),
            ));
      anchor.target = target;
      const velocity = b3.b3Body_GetLinearVelocity([0, 0, 0], body.id);
      const force = target.map(
        (v, k) =>
          (v - body.position[k]) * SCALE * body.mass * 520 -
          velocity[k] * body.mass * (this.underwater ? 50 : 36),
      );
      b3.b3Body_ApplyForceToCenter(body.id, force, true);
      anchor.load = Math.abs(dot(force, anchor.direction)) / SCALE;
    }
    b3.b3World_Step(this.world, STEP, 4);
    this.time += STEP;
    this.read();
    for (const component of this.loadedComponents) {
      const tension =
        component.anchors.reduce((sum, a) => sum + a.load, 0) /
        component.anchors.length;
      component.load += (tension - component.load) * (1 - Math.exp(-STEP * 8));
    }
    this.load = Math.max(0, ...this.loadedComponents.map((c) => c.load));
    if (
      !this.broken &&
      !this.pendingFracture &&
      this.time - (this.fracture?.completeTime ?? -10) > 0.65 &&
      this.slackRemaining < 0.025 &&
      this.time > 0.6 &&
      this.load > this.strength
    )
      this.breakLink();
    if (this.hinge) {
      const age = this.time - this.fracture.time;
      const [a, b] = this.pendingFracture.fragments;
      const opening =
        2 * Math.acos(Math.min(1, Math.abs(dot(a.quaternion, b.quaternion))));
      this.fracture.opening = opening;
      const ends = this.pendingFracture.fragments.map((b) =>
        rotateVector(linkPoint(CUT), b.quaternion).map(
          (v, k) => v + b.position[k],
        ),
      );
      this.fracture.position = ends[0].map((v, k) => (v + ends[1][k]) / 2);
      // A one-sided crack remains joined until the two U sections twist apart.
      if (age > 0.32 && (opening > 0.6 || (age > 0.9 && pull > 0)))
        this.completeFracture();
    }
  }
  read() {
    for (const body of [...this.links, ...this.fragments, this.mine])
      if (body) {
        b3.b3Body_GetPosition(body.position, body.id);
        for (let k = 0; k < 3; k++) body.position[k] /= SCALE;
        b3.b3Body_GetRotation(body.quaternion, body.id);
        b3.b3Body_GetLinearVelocity(body.velocity, body.id);
        for (let k = 0; k < 3; k++) body.velocity[k] /= SCALE;
      }
  }
  breakLink() {
    if (this.broken || this.pendingFracture) return;
    const candidates = this.failureCandidates;
    if (!candidates.length) return;
    const index =
      !this.fractures.length && this.forcedWeakLink !== null
        ? this.forcedWeakLink
        : this.chooseBreakLink
          ? this.chooseBreakLink(this)
          : candidates[
              (Math.imul(this.seed + 1 + this.fractures.length, 2654435761) >>>
                0) %
                candidates.length
            ];
    if (index === null) return;
    if (!this.eligibleLinks.includes(index))
      throw new RangeError("Invalid weak link");
    this.weakLink = index;
    const parent = this.links[this.weakLink];
    const velocity = b3.b3Body_GetLinearVelocity([0, 0, 0], parent.id);
    const angular = b3.b3Body_GetAngularVelocity([0, 0, 0], parent.id);
    this.fracture = {
      position: [...parent.position],
      quaternion: [...parent.quaternion],
      load: this.load,
      time: this.time,
      index: this.weakLink,
      mode: this.fractureMode,
      opening: 0,
      fragments: [],
      order: this.fractures.length,
    };
    this.pendingFracture = this.fracture;
    this.fractures.push(this.fracture);
    b3.b3DestroyBody(parent.id);
    this.links[this.weakLink] = null;
    const count = this.fractureMode === "shatter" ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const start = CUT + i / count,
        span = 1 / count;
      const path = Array.from({ length: Math.round(36 * span) + 1 }, (_, n) =>
        linkPoint(start + n / 36),
      );
      const fragment = this.createBody(
        parent.position,
        parent.quaternion,
        path,
        false,
        LINK,
        parent.mass / count,
      );
      fragment.start = start;
      fragment.span = span;
      const center = b3.b3Body_GetWorldCenterOfMass([0, 0, 0], fragment.id);
      const offset = center.map((v, k) => v - parent.position[k] * SCALE);
      const rotational = cross(angular, offset);
      b3.b3Body_SetLinearVelocity(
        fragment.id,
        velocity.map((v, k) => v + rotational[k]),
      );
      b3.b3Body_SetAngularVelocity(fragment.id, angular);
      this.fragments.push(fragment);
      this.fracture.fragments.push(fragment);
    }
    if (this.fractureMode === "tear") {
      const joint = b3.b3DefaultSphericalJointDef();
      joint.base.bodyIdA = this.fracture.fragments[0].id;
      joint.base.bodyIdB = this.fracture.fragments[1].id;
      const frame = {
        position: scaled(linkPoint(CUT)),
        quaternion: [0, 0, 0, 1],
      };
      joint.base.localFrameA = frame;
      joint.base.localFrameB = frame;
      joint.base.collideConnected = false;
      joint.enableSpring = true;
      joint.hertz = 2;
      joint.dampingRatio = 0.25;
      this.hinge = b3.b3CreateSphericalJoint(this.world, joint);
      // A small torsional release opens the first crack; the other side holds.
      const torque = rotateVector(
        [0, 0, parent.mass * 0.3 * SCALE],
        parent.quaternion,
      );
      this.fracture.fragments.forEach((fragment, i) =>
        b3.b3Body_ApplyAngularImpulse(
          fragment.id,
          torque.map((v) => v * (i ? 1 : -1)),
          true,
        ),
      );
    } else this.completeFracture();
    this.read();
  }
  completeFracture() {
    if (!this.pendingFracture) return;
    if (this.hinge) {
      b3.b3DestroyJoint(this.hinge, true);
      this.hinge = null;
      const ends = this.fracture.fragments.map((b) =>
        rotateVector(linkPoint(CUT), b.quaternion).map(
          (v, k) => v + b.position[k],
        ),
      );
      this.fracture.position = ends[0].map((v, k) => (v + ends[1][k]) / 2);
    }
    this.fracture.completeTime = this.time;
    const neighbors = this.edges
      .filter((e) => e[0] === this.weakLink || e[1] === this.weakLink)
      .map((e) => (e[0] === this.weakLink ? e[1] : e[0]))
      .filter((index) => this.links[index]);
    const directions = neighbors.map((index) =>
      normalize(
        this.links[index].position.map((v, k) => v - this.fracture.position[k]),
      ),
    );
    const mean = [0, 1, 2].map(
      (k) => directions.reduce((sum, d) => sum + d[k], 0) / directions.length,
    );
    neighbors.forEach((index, i) =>
      b3.b3Body_ApplyLinearImpulseToCenter(
        this.links[index].id,
        directions[i].map(
          (v, k) => (v - mean[k]) * this.links[0].mass * 1.6 * SCALE,
        ),
        true,
      ),
    );
    this.pendingFracture = null;
    this.updateLoadPaths();
    this.broken = this.loadedComponents.length === 0;
  }
  advance(dt, pull = 1) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.accumulator += dt;
    while (this.accumulator >= STEP - 1e-10) {
      this.step(pull);
      this.accumulator -= STEP;
    }
  }
  releaseAnchors() {
    if (this.broken) this.anchorsReleased = true;
  }
  inspect() {
    return {
      time: this.time,
      chainCount: this.chainCount,
      fractureMode: this.fractureMode,
      tearing: !!this.hinge,
      anchorLoads: this.anchors.map((a) => a.load),
      drawVelocity: this.drawVelocity,
      extension: this.extension,
      slackRemaining: this.slackRemaining,
      weakLink: this.weakLink,
      load: this.load,
      strength: this.strength,
      broken: this.broken,
      anchorsReleased: this.anchorsReleased,
      bodies: this.links.filter(Boolean).length + this.fragments.length,
      fragments: this.fragments.length,
      fractures: this.fractures.length,
      tensionPaths: this.loadedComponents.length,
      contacts: b3.b3World_GetCounters(this.world).contactCount,
    };
  }
  dispose() {
    b3.b3DestroyWorld(this.world);
  }
}
