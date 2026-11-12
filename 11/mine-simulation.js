import { TensionSimulation, b3, SCALE, STEP } from "./tension-simulation.js";
import {
  LINK_PITCH,
  alignY,
  multiplyQuaternion,
  colliderPath,
  rotateVector,
} from "./link-shape.js";
import { MINE_EYE, EYE_CENTER, FIRST_LINK_DROP } from "./mine-attachment.js";

export const MINE_RADIUS = 1.28;
export const MINE_HOME = [0, -0.6, 0];
export const MINE_LINK_STRENGTH = 60000;

// The shell and forged eye form one rigid body. The first link threads through
// its capsule collision surface; every chain connection uses physical contact.
export class MineSimulation extends TensionSimulation {
  constructor(options = {}) {
    super({ strength: MINE_LINK_STRENGTH, ...options, layout: "mine" });
    this.dragTarget = null;
    this.grabLocal = null;
    this.grabOffset = null;
    this.lift = 0;
    this.arrivalY = options.arrivalY ?? null;
    this.phase = this.arrivalY === null ? "ready" : "rising";
    this.catchAge = 0;
    this.controlled = false;
    this.chainDamped = false;
    this.recoil = [];
    this.breakableLinks =
      this.chainCount === 1
        ? this.chains[0].slice(1, -1)
        : [
            2,
            3,
            5,
            6,
            8,
            9,
            ...this.chains.slice(1).flatMap((c) => c.slice(1, 5)),
          ];
    const def = b3.b3DefaultBodyDef();
    def.type = b3.b3BodyType.b3_dynamicBody;
    const initialPosition = [0, this.arrivalY ?? MINE_HOME[1], 0];
    def.position = initialPosition.map((v) => v * SCALE);
    def.gravityScale = 0;
    def.linearDamping = 1.1;
    def.angularDamping = 3.5;
    def.enableSleep = false;
    const id = b3.b3CreateBody(this.world, def);
    const shape = b3.b3DefaultShapeDef();
    shape.density = 3600 / ((4 / 3) * Math.PI * (MINE_RADIUS * SCALE) ** 3);
    shape.baseMaterial.friction = 0.3;
    b3.b3CreateSphereShape(id, shape, {
      center: [0, 0, 0],
      radius: MINE_RADIUS * SCALE,
    });
    const eyeShape = b3.b3DefaultShapeDef();
    eyeShape.density = 0;
    eyeShape.baseMaterial.friction = 0.3;
    eyeShape.baseMaterial.restitution = 0.02;
    const path = colliderPath(12, MINE_EYE).map((p) =>
      p.map((v, k) => (v + EYE_CENTER[k]) * SCALE),
    );
    for (let i = 0; i < path.length; i++)
      b3.b3CreateCapsuleShape(id, eyeShape, {
        center1: path[i],
        center2: path[(i + 1) % path.length],
        radius: MINE_EYE.tube * SCALE,
      });
    this.mine = {
      id,
      position: [...initialPosition],
      previousPosition: [...initialPosition],
      quaternion: [0, 0, 0, 1],
      previousQuaternion: [0, 0, 0, 1],
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      mass: b3.b3Body_GetMass(id),
    };
    if (this.arrivalY !== null) this.arrangeArrival();
    else {
      const origin = [...this.links[0].position];
      const inverse = this.links[0].quaternion.map((v, k) => (k < 3 ? -v : v));
      const rotation = multiplyQuaternion(
        [Math.SQRT1_2, 0, Math.SQRT1_2, 0],
        inverse,
      );
      this.links.forEach((body) => {
        body.position = rotateVector(
          body.position.map((v, k) => v - origin[k]),
          rotation,
        );
        body.position[1] += MINE_HOME[1] - FIRST_LINK_DROP;
        body.previousPosition = [...body.position];
        body.quaternion = multiplyQuaternion(rotation, body.quaternion);
        body.previousQuaternion = [...body.quaternion];
        b3.b3Body_SetTransform(
          body.id,
          body.position.map((v) => v * SCALE),
          body.quaternion,
        );
      });
      for (const anchor of this.anchors)
        anchor.base = [...this.links[anchor.index].position];
    }
    this.anchors[0].passive = true;
    this.anchors[0].direction = [0, 1, 0];
    for (const anchor of this.anchors.slice(1)) {
      anchor.externalTarget =
        this.arrivalY !== null && anchor.index === this.chains[0].at(-1)
          ? [0, anchor.base[1], 0]
          : [...anchor.base];
      anchor.direction = [0, -1, 0];
    }
    this.updateLoadPaths();
  }
  arrangeArrival() {
    // Coil the slack tether beneath the incoming mine. Its lower mount stays
    // fixed: the rising shell really uncoils the links and is caught by them.
    const count = this.chains[0].length,
      steps = count - 1;
    const top = this.arrivalY - FIRST_LINK_DROP;
    const bottom = MINE_HOME[1] - FIRST_LINK_DROP - steps * LINK_PITCH * 0.99;
    // A folded U starts downward from the eye, leaving the shell clear even
    // with the deeper portrait entrance. Rotating its endpoint chord vertical
    // places the lower mount directly beneath the mine.
    const chord = top - bottom;
    const radius = Math.min(1.2, chord * 0.4);
    const drop = Math.sqrt(chord * chord - 4 * radius * radius);
    const straight = (steps * LINK_PITCH - Math.PI * radius + drop) / 2;
    const angle = -Math.atan2(2 * radius, drop);
    const rotate = ([x, y, z]) => [
      x * Math.cos(angle) - y * Math.sin(angle),
      x * Math.sin(angle) + y * Math.cos(angle),
      z,
    ];
    const firstDirection = rotate([0, -1, 0]);
    const origin = firstDirection.map(
      (v, k) => this.mine.position[k] + EYE_CENTER[k] + v * 0.34,
    );
    for (let i = 0; i < count; i++) {
      const travel = i * LINK_PITCH;
      let local, tangent;
      if (travel < straight) {
        local = [0, -travel, 0];
        tangent = [0, -1, 0];
      } else if (travel < straight + Math.PI * radius) {
        const a = (travel - straight) / radius;
        local = [
          radius * (1 - Math.cos(a)),
          -straight - radius * Math.sin(a),
          0,
        ];
        tangent = [Math.sin(a), -Math.cos(a), 0];
      } else {
        local = [
          2 * radius,
          -straight + travel - straight - Math.PI * radius,
          0,
        ];
        tangent = [0, 1, 0];
      }
      const p = rotate(local).map((v, k) => v + origin[k]);
      const frame = alignY(rotate(tangent));
      const twist = (((i + 1) % 2) * Math.PI) / 2;
      const q = multiplyQuaternion(frame, [
        0,
        Math.sin(twist / 2),
        0,
        Math.cos(twist / 2),
      ]);
      const link = this.links[i];
      link.position = [...p];
      link.previousPosition = [...p];
      link.quaternion = [...q];
      link.previousQuaternion = [...q];
      b3.b3Body_SetTransform(
        link.id,
        p.map((v) => v * SCALE),
        q,
      );
    }
    for (const anchor of this.anchors)
      anchor.base = [...this.links[anchor.index].position];
  }
  get slackRemaining() {
    const distances = new Map([[0, 0]]),
      queue = [0];
    while (queue.length) {
      const i = queue.shift();
      for (const [a, b, length] of this.edges) {
        const next = a === i ? b : b === i ? a : -1;
        if (next < 0 || distances.has(next) || !this.links[next]) continue;
        distances.set(next, distances.get(i) + length);
        queue.push(next);
      }
    }
    const top = this.links[0].position;
    const slack = this.anchors
      .slice(1)
      .filter((a) => distances.has(a.index))
      .map(
        (a) =>
          distances.get(a.index) -
          Math.hypot(...this.links[a.index].position.map((v, k) => v - top[k])),
      );
    // A branched tether can be taut around a junction while its endpoint chord
    // still looks slack. Upward shell travel also detects that configuration.
    const rise = this.mine ? this.mine.position[1] - MINE_HOME[1] : 0;
    return Math.max(0, Math.min(...slack, 0.85 - rise));
  }
  updateLoadPaths() {
    super.updateLoadPaths();
    // Only paths leading back to the mine can be loaded by its buoyancy.
    this.loadedComponents = this.loadedComponents.filter((c) => c.links.has(0));
    this.loadedLinks = new Set(
      this.loadedComponents.flatMap((c) => [...c.links]),
    );
    this.eligibleLinks = this.breakableLinks.filter((i) =>
      this.loadedLinks.has(i),
    );
    this.focusedComponent = this.loadedComponents[0];
    for (const anchor of this.anchors) delete anchor.releaseTime;
  }
  beginDrag(point) {
    const body = this.mine;
    this.grabOffset = point.map((v, k) => v - body.position[k]);
    this.grabLocal = rotateVector(
      this.grabOffset,
      body.quaternion.map((v, k) => (k < 3 ? -v : v)),
    );
    this.dragTarget = [...body.position];
  }
  endDrag() {
    this.dragTarget = null;
    this.grabLocal = this.grabOffset = null;
  }
  step(pull = 0) {
    const mine = this.mine;
    const settled = this.phase === "ready" && !this.broken;
    if (settled !== this.chainDamped) {
      this.chainDamped = settled;
      // Strong water resistance settles the suspended tether. Release that
      // extra damping after fracture so loose links still recoil and sink.
      for (const body of this.links)
        if (body) {
          b3.b3Body_SetLinearDamping(body.id, settled ? 4 : 0.7);
          b3.b3Body_SetAngularDamping(body.id, settled ? 8 : 2);
        }
    }
    this.anchors[0].load = Math.max(
      0,
      ...this.anchors.slice(1).map((a) => a.load),
    );
    this.controlled = !this.broken && (!!this.dragTarget || pull > 0);
    if (!this.broken && this.arrivalY !== null && !this.controlled) {
      this.lift = 0;
      const force = [
        -mine.position[0] * 1.2 - mine.velocity[0] * 3.5,
        7.0 - mine.velocity[1] * 2.5,
        -mine.position[2] * 1.2 - mine.velocity[2] * 3.5,
      ].map((v) => v * 2400 * SCALE);
      b3.b3Body_ApplyForceToCenter(mine.id, force, true);
    } else if (!this.broken) {
      if (pull > 0 && !this.dragTarget)
        this.lift +=
          STEP *
          (pull > 1 ? 0.9 : 0.45) *
          Math.min(1, Math.max(0, this.time - 1.2));
      else if (!this.dragTarget) this.lift *= Math.exp(-STEP * 1.4);
      const target = this.dragTarget ?? [
        Math.sin(this.time * 0.38 + this.seed) * 0.09,
        MINE_HOME[1] + this.lift,
        0,
      ];
      const grabbed = !!this.dragTarget && !!this.grabLocal;
      const lever = grabbed
        ? rotateVector(this.grabLocal, mine.quaternion)
        : [0, 0, 0];
      const point = mine.position.map((v, k) => (v + lever[k]) * SCALE);
      const velocity = grabbed
        ? b3
            .b3Body_GetWorldPointVelocity([0, 0, 0], mine.id, point)
            .map((v) => v / SCALE)
        : mine.velocity;
      const verticalLimit =
        (this.arrivalY === null ? 14 : Math.max(17, this.strength / 2400 + 6)) *
        this.chainCount;
      const force = target.map(
        (v, k) =>
          (Math.max(
            k === 1 ? -verticalLimit : -8,
            Math.min(
              k === 1 ? verticalLimit : 8,
              (v +
                (grabbed ? this.grabOffset[k] - lever[k] : 0) -
                mine.position[k]) *
                (k === 1 ? 18 : 12),
            ),
          ) -
            velocity[k] * 8) *
          2400 *
          SCALE,
      );
      if (grabbed) b3.b3Body_ApplyForce(mine.id, force, point, true);
      else b3.b3Body_ApplyForceToCenter(mine.id, force, true);
      // Buoyancy acts at the shell's center; only the hand imparts torque.
      b3.b3Body_ApplyForceToCenter(
        mine.id,
        [0, (this.arrivalY === null ? 0.6 : 7) * 2400 * SCALE, 0],
        true,
      );
    } else {
      this.endDrag();
      b3.b3Body_ApplyForceToCenter(
        mine.id,
        [
          Math.sin(this.time * 0.4) * mine.mass * SCALE * 0.12,
          mine.mass * SCALE * 4.2,
          0,
        ],
        true,
      );
      this.anchorsReleased = true;
    }
    // Slow restoring torque keeps the heavy shell upright while allowing a tug
    // to tilt it naturally around the attachment beneath the sphere.
    const angular = b3.b3Body_GetAngularVelocity([0, 0, 0], mine.id);
    b3.b3Body_ApplyTorque(
      mine.id,
      [0, 1, 2].map(
        (k) =>
          (k === 1
            ? Math.sin(this.time * 0.4 + this.seed) * 0.006
            : -mine.quaternion[k] * 1.6) *
            mine.mass *
            SCALE ** 2 -
          angular[k] * mine.mass * SCALE ** 2 * 0.9,
      ),
      true,
    );
    this.advanceRecoil();
    super.step(pull);
    mine.angularVelocity = b3.b3Body_GetAngularVelocity([0, 0, 0], mine.id);
    if (this.broken) this.phase = "released";
    else if (this.phase !== "ready") {
      const caught =
        mine.position[1] > MINE_HOME[1] - 0.5 &&
        Math.abs(mine.velocity[1]) < 0.2 &&
        this.anchors[0].load > 2500;
      this.catchAge = caught ? this.catchAge + STEP : 0;
      if (caught) this.phase = "catching";
      if (this.catchAge > 0.4) this.phase = "ready";
    }
  }
  breakLink() {
    if (this.arrivalY !== null && !this.controlled) return;
    super.breakLink();
  }
  completeFracture() {
    const fracture = this.pendingFracture;
    super.completeFracture();
    if (!fracture || !this.broken || this.arrivalY === null) return;
    this.startRecoil(fracture);
    // The free lower length sinks faster than the tether's deliberately slow
    // suspended motion. Keep the original weight for links still hanging from the mine.
    const attached = new Set([0]),
      queue = [0];
    while (queue.length) {
      const i = queue.pop();
      for (const [a, b] of this.edges) {
        const next = a === i ? b : b === i ? a : -1;
        if (next < 0 || attached.has(next) || !this.links[next]) continue;
        attached.add(next);
        queue.push(next);
      }
    }
    this.links.forEach((body, i) => {
      if (body && !attached.has(i)) b3.b3Body_SetGravityScale(body.id, 2.4);
    });
    for (const body of this.fragments) b3.b3Body_SetGravityScale(body.id, 2.4);
  }
  startRecoil(fracture) {
    // Release a traveling bend through both surviving lengths. These are
    // physical impulses; contact still keeps every intact link interlocked.
    const neighbors = this.edges
      .flatMap(([a, b]) =>
        a === fracture.index ? [b] : b === fracture.index ? [a] : [],
      )
      .filter((i) => this.links[i]);
    const visited = new Set([fracture.index]);
    neighbors.forEach((start, side) => {
      const delta = this.links[start].position.map(
        (v, k) => v - fracture.position[k],
      );
      const length = Math.hypot(...delta) || 1;
      const axis = delta.map((v) => v / length);
      const angle = this.seed * 1.7 + fracture.index * 0.61;
      const bend = [Math.cos(angle), 0, Math.sin(angle)];
      const dot = bend.reduce((sum, v, k) => sum + v * axis[k], 0);
      const crosswise = bend.map((v, k) => v - dot * axis[k]);
      const crossLength = Math.hypot(...crosswise) || 1;
      const transverse = crosswise.map(
        (v) => (v / crossLength) * (side ? 1 : -1),
      );
      const queue = [[start, 0]];
      while (queue.length) {
        const [index, hop] = queue.shift();
        if (visited.has(index) || !this.links[index]) continue;
        visited.add(index);
        const kick = 2.4 * Math.exp(-hop * 0.2);
        const whip = 2.2 * Math.cos(hop * 0.7) * Math.exp(-hop * 0.065);
        this.recoil.push({
          index,
          time: this.time + hop * 0.04,
          velocity: axis.map((v, k) => v * kick + transverse[k] * whip),
        });
        for (const [a, b] of this.edges) {
          const next = a === index ? b : b === index ? a : -1;
          if (next >= 0 && !visited.has(next)) queue.push([next, hop + 1]);
        }
      }
    });
  }
  advanceRecoil() {
    for (let i = this.recoil.length - 1; i >= 0; i--) {
      const pulse = this.recoil[i];
      if (this.time + STEP * 0.5 < pulse.time) continue;
      const body = this.links[pulse.index];
      if (body) {
        const lever = rotateVector([0.055, 0, 0.02], body.quaternion);
        b3.b3Body_ApplyLinearImpulse(
          body.id,
          pulse.velocity.map((v) => v * body.mass * SCALE),
          body.position.map((v, k) => (v + lever[k]) * SCALE),
          true,
        );
      }
      this.recoil.splice(i, 1);
    }
  }
  inspect() {
    return {
      ...super.inspect(),
      phase: this.phase,
      mine: {
        position: [...this.mine.position],
        velocity: [...this.mine.velocity],
        dragging: !!this.dragTarget,
        lift: this.lift,
      },
    };
  }
}
