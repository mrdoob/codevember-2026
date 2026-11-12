import {
  TensionSimulation,
  STEP,
  CENTER_LINK,
} from "../../tension-simulation.js";

export const CHAIN_SPACING = 6.4;
export const CAMERA_DISTANCE = 3.15;
export const cameraDistance = (chainCount = 1) =>
  [3.15, 4.05, 4.45][chainCount - 1];
export const TRANSITION_DURATION = 3.2;
export const cameraFov = (aspect, chainCount = 1) =>
  aspect < 0.8 ? [60, 70, 78][chainCount - 1] : 46;
// Covers the complete link, surface irregularities, and a little screen margin.
const RETIRE_RADIUS = 0.6;
export function belowRetirementView(shot, pose, futurePose, aspect) {
  const tangent = Math.tan((cameraFov(aspect, 3) * Math.PI) / 360);
  const padding = RETIRE_RADIUS * Math.sqrt(1 + tangent * tangent);
  return [...shot.simulation.links, ...shot.simulation.fragments].every(
    (body) =>
      !body ||
      [body.position, body.previousPosition].every((p) =>
        [pose, futurePose].every(
          (view) =>
            p[1] - view.y + (view.z - shot.z - p[2]) * tangent < -padding,
        ),
      ),
  );
}
export const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export function chainAngle(index) {
  return (
    [0.42, -0.55, 0.86, -0.22, -0.92, 0.14][index % 6] +
    Math.sin(index * 1.73) * 0.045
  );
}

export class BreakingJourney {
  constructor({
    onCreate = () => {},
    onBreak = () => {},
    onCrack = () => {},
    onRemove = () => {},
    onAdvance = () => {},
    seed = Math.floor(Math.random() * 4294967296),
    getAspect = () => 16 / 9,
  } = {}) {
    this.callbacks = { onCreate, onBreak, onCrack, onRemove, onAdvance };
    this.randomState = seed >>> 0;
    this.getAspect = getAspect;
    this.lastBreak = null;
    this.lastChainCount = 0;
    this.lastFractureMode = null;
    this.time = 0;
    this.physicsTime = 0;
    this.accumulator = 0;
    this.shots = [];
    this.index = 0;
    this.transitionAge = -1;
    this.fractureAge = -1;
    this.breaks = 0;
    this.current = this.createShot(0);
    this.next = null;
  }
  createShot(index) {
    this.randomState =
      (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    const choices = [1, 2, 3].filter((n) => n !== this.lastChainCount);
    const chainCount =
      index === 0
        ? 1
        : choices[Math.floor((this.randomState / 4294967296) * choices.length)];
    this.lastChainCount = chainCount;
    this.randomState =
      (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    const modes = ["snap", "tear", "shatter"].filter(
      (mode) => mode !== this.lastFractureMode,
    );
    const fractureMode =
      index === 0
        ? "snap"
        : modes[Math.floor((this.randomState / 4294967296) * modes.length)];
    this.lastFractureMode = fractureMode;
    const shot = {
      index,
      z:
        this.current?.index === index - 1
          ? this.current.z + CHAIN_SPACING + this.current.depthOffset
          : index * CHAIN_SPACING,
      depthOffset: 0,
      outsideTime: 0,
      viewCenter: [0, 0, 0],
      reportedCracks: 0,
      reportedBreaks: 0,
      simulation: new TensionSimulation({
        angle: chainAngle(index),
        seed: index,
        chainCount,
        fractureMode,
        chooseBreakLink: (sim) => this.chooseBreakLink(sim),
        strength: 35000 * (1 + 0.07 * Math.sin(index * 2.1)),
      }),
    };
    this.shots.push(shot);
    this.callbacks.onCreate(shot);
    return shot;
  }
  chooseBreakLink(sim) {
    const shot = this.shots.find((shot) => shot.simulation === sim);
    const center = shot?.viewCenter ?? sim.links[CENTER_LINK].position,
      aspect = this.getAspect();
    const tangent = Math.tan(
      (cameraFov(aspect, sim.chainCount) * Math.PI) / 360,
    );
    // Sample only visible link centers, without moving the camera toward one.
    const visible = sim.failureCandidates.filter((i) => {
      const p = sim.links[i].position,
        halfHeight =
          (cameraDistance(sim.chainCount) + (shot?.depthOffset ?? 0) - p[2]) *
          tangent;
      return (
        Math.abs(p[0] - center[0]) < halfHeight * aspect - 0.2 &&
        Math.abs(p[1] - center[1]) < halfHeight - 0.16
      );
    });
    const different = visible.filter((i) => i !== this.lastBreak);
    const candidates = different.length ? different : visible;
    this.randomState =
      (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    const index =
      candidates[
        Math.floor((this.randomState / 4294967296) * candidates.length)
      ] ?? null;
    if (index !== null) this.lastBreak = index;
    return index;
  }
  advance(dt, { auto = true, pulling = false, speed = 1, strength = 1 } = {}) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.accumulator += dt * speed;
    while (this.accumulator >= STEP - 1e-10) {
      this.time += STEP;
      const transition = this.transitionAge >= 0;
      if (this.fractureAge >= 0) this.fractureAge += STEP;
      const scale = transition
        ? 0.22 + 0.78 * smooth(0.8, 1.55, this.transitionAge)
        : this.fractureAge >= 0
          ? 0.3 + 0.7 * smooth(0.18, 0.65, this.fractureAge)
          : 1;
      const physicalStep = STEP * scale;
      this.physicsTime += physicalStep;
      for (const shot of this.shots) {
        // Its center must stay on the retreat path until the camera clears it.
        if (shot === this.next) continue;
        const pull =
          shot === this.current ? (auto ? 1 : 0) + (pulling ? 2.7 : 0) : 0;
        if (shot === this.current && !shot.simulation.broken)
          shot.simulation.strength =
            35000 * (1 + 0.07 * Math.sin(shot.index * 2.1)) * strength;
        shot.simulation.advance(physicalStep, pull);
      }
      this.callbacks.onAdvance(physicalStep);
      const shot = this.current,
        active = shot.simulation;
      if (!active.fractures.length)
        shot.viewCenter = [...active.links[CENTER_LINK].position];
      else if (!active.broken) {
        const target = active.pendingFracture
            ? active.fracture.position
            : active.focusPoint(),
          blend = 1 - Math.exp(-STEP * (active.pendingFracture ? 6 : 3));
        shot.viewCenter = shot.viewCenter.map(
          (v, k) => v + (target[k] - v) * blend,
        );
      }
      if (active.chainCount > 1 && active.fractures.length)
        shot.depthOffset = Math.max(shot.depthOffset, shot.viewCenter[2]);
      if (active.fractures.length > shot.reportedCracks) {
        shot.reportedCracks = active.fractures.length;
        if (active.pendingFracture) this.callbacks.onCrack(shot);
      }
      const completed = active.fractures.filter(
        (f) => f.completeTime !== undefined,
      ).length;
      if (completed > shot.reportedBreaks) {
        shot.reportedBreaks = completed;
        shot.breakCenter = [...shot.viewCenter];
        this.fractureAge = 0;
        this.breaks++;
        this.callbacks.onBreak(shot);
      }
      if (active.broken && !transition) {
        this.transitionAge = 0;
        this.next = this.createShot(this.index + 1);
      } else if (transition) {
        this.transitionAge += STEP;
        if (this.transitionAge >= TRANSITION_DURATION) {
          // Once the camera has moved on, let the broken chain fall freely.
          this.current.simulation.releaseAnchors();
          this.current = this.next;
          this.next = null;
          this.index++;
          this.transitionAge = -1;
          this.fractureAge = -1;
        }
      }
      this.retireFallenChains(STEP);
      this.accumulator -= STEP;
    }
  }
  retireFallenChains(dt) {
    const aspect = this.getAspect(),
      pose = this.cameraPose(aspect);
    // Include the next retreat: an old chain must not re-enter the wider view.
    const futurePose = {
      y: 0,
      z:
        this.current.z +
        cameraDistance(3) +
        CHAIN_SPACING +
        Math.max(
          this.current.depthOffset,
          ...this.current.simulation.eligibleLinks.map(
            (i) => this.current.simulation.links[i]?.position[2] ?? 0,
          ),
        ),
    };
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      if (shot === this.current || shot === this.next) continue;
      const clear = belowRetirementView(shot, pose, futurePose, aspect);
      shot.outsideTime = clear ? shot.outsideTime + dt : 0;
      if (shot.outsideTime < 0.75) continue;
      this.shots.splice(i, 1);
      this.callbacks.onRemove(shot);
      shot.simulation.dispose();
    }
  }
  cameraPose(aspect = this.getAspect()) {
    const shot = this.current,
      sim = shot.simulation;
    const center = sim.broken
      ? shot.breakCenter
      : sim.fractures.length
        ? shot.viewCenter
        : sim.links[CENTER_LINK].position;
    const fraction = sim.broken ? 1 : Math.min(1, sim.load / sim.strength);
    const age = this.transitionAge;
    // React after the snap; the camera never reveals the next failure site.
    const follow = sim.broken
      ? (aspect < 0.8 ? 0.85 : 0.25) * smooth(0, 0.3, age)
      : 0;
    const point = center.map(
      (v, k) => v + ((sim.fracture?.position[k] ?? v) - v) * follow,
    );
    const retreat = age >= 0 ? smooth(0.48, TRANSITION_DURATION, age) : 0;
    // Hold the fracture in frame, then center before entering the next ring.
    const track = age >= 0 ? 1 - smooth(0.6, 1.55, age) : 1;
    const shake =
      this.fractureAge >= 0
        ? 0.018 * Math.exp(-this.fractureAge * 6)
        : 0.0017 * fraction ** 4;
    const distance = cameraDistance(sim.chainCount);
    const nextDistance = this.next
      ? cameraDistance(this.next.simulation.chainCount)
      : distance;
    const startZ = shot.z + distance + shot.depthOffset;
    const z =
      startZ +
      retreat *
        ((this.next?.z ?? shot.z + CHAIN_SPACING) + nextDistance - startZ);
    const x = point[0] * track + Math.sin(this.time * 71) * shake;
    const y = point[1] * track + Math.sin(this.time * 53 + 0.7) * shake;
    const incoming = this.next && z > this.next.z + 0.06;
    const targetZ = incoming ? this.next.z : shot.z + point[2] * track;
    const focus = Math.max(0.12, z - targetZ);
    const fov = cameraFov(aspect, sim.chainCount);
    const nextFov = this.next
      ? cameraFov(aspect, this.next.simulation.chainCount)
      : fov;
    return {
      fov: fov + (nextFov - fov) * retreat,
      x,
      y,
      z,
      target: [x, y, targetZ],
      focus,
      retreat,
      lightZ:
        shot.z + retreat * ((this.next?.z ?? shot.z + CHAIN_SPACING) - shot.z),
    };
  }
  inspect() {
    return {
      time: this.time,
      index: this.index,
      breaks: this.breaks,
      transitionAge: this.transitionAge,
      fractureAge: this.fractureAge,
      shots: this.shots.length,
      angle: this.current.simulation.angle,
      camera: this.cameraPose(),
      physics: this.current.simulation.inspect(),
    };
  }
  dispose() {
    for (const shot of this.shots) {
      this.callbacks.onRemove(shot);
      shot.simulation.dispose();
    }
    this.shots.length = 0;
  }
}
