import {
  MineSimulation,
  MINE_RADIUS,
  MINE_LINK_STRENGTH,
} from "./mine-simulation.js";
import { STEP } from "./tension-simulation.js";
export const cameraFov = (aspect) => (aspect < 0.8 ? 58 : 46);
const distance = (aspect) =>
  Math.max(
    7.3,
    4.5 / (2 * Math.tan((cameraFov(aspect) * Math.PI) / 360) * aspect),
  );

// Coordinates in the level, orbiting camera's frame; depth is positive ahead.
function viewCoordinates(p, pose, z = 0) {
  const dx = p[0] - pose.x,
    dz = p[2] + z - pose.z,
    sin = Math.sin(pose.azimuth),
    cos = Math.cos(pose.azimuth);
  return [dx * cos - dz * sin, p[1] - pose.y, -dx * sin - dz * cos];
}

export class MineJourney {
  constructor({
    onCreate = () => {},
    onCrack = () => {},
    onBreak = () => {},
    onRemove = () => {},
    onAdvance = () => {},
    seed = Math.floor(Math.random() * 4294967296),
    getAspect = () => 16 / 9,
  } = {}) {
    this.callbacks = { onCreate, onCrack, onBreak, onRemove, onAdvance };
    this.getAspect = getAspect;
    this.randomState = seed >>> 0;
    this.time = 0;
    this.orbitAngle = 0;
    this.accumulator = 0;
    this.index = 0;
    this.breaks = 0;
    this.recentBreakLinks = [];
    this.shots = [];
    this.transitionAge = -1;
    this.fractureAge = -1;
    this.current = this.createShot(0);
    this.next = null;
  }
  random() {
    return (
      (this.randomState =
        (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0) / 4294967296
    );
  }
  createShot(index, preparing = false) {
    const shot = {
      index,
      z: 0,
      outsideTime: 0,
      reportedCracks: 0,
      reportedBreaks: 0,
      stressLink: null,
      simulation: new MineSimulation({
        seed: index,
        arrivalY: -Math.max(
          6.1,
          distance(this.getAspect()) *
            Math.tan((cameraFov(this.getAspect()) * Math.PI) / 360) +
            2.6,
        ),
        chainCount: 1,
        angle: index * 0.7,
        fractureMode: ["snap", "tear", "shatter"][index % 3],
        chooseBreakLink: (sim) => this.chooseBreakLink(sim),
      }),
    };
    this.shots.push(shot);
    shot.ready = this.callbacks.onCreate(shot, preparing) !== false;
    return shot;
  }
  prepareNext() {
    if (!this.next) this.next = this.createShot(this.index + 1, true);
    return this.next;
  }
  chooseBreakLink(sim) {
    const shot = this.shots.find((s) => s.simulation === sim);
    // Once a link begins glowing, commit to it through release and renewed
    // pulling. The eventual fracture must occur at the illuminated location.
    if (
      shot.stressLink !== null &&
      sim.failureCandidates.includes(shot.stressLink)
    )
      return shot.stressLink;
    const pose = this.cameraPose(),
      aspect = this.getAspect(),
      tan = Math.tan((pose.fov * Math.PI) / 360);
    const visible = sim.failureCandidates.filter((i) => {
      const [x, y, depth] = viewCoordinates(
          sim.links[i].position,
          pose,
          shot.z,
        ),
        h = depth * tan;
      return (
        depth > 0 && Math.abs(x) < h * aspect - 0.22 && Math.abs(y) < h - 0.3
      );
    });
    if (!visible.length) return null;
    // Select a visible loaded link as tension builds; recent completed breaks
    // are avoided so consecutive mines still fail at different locations.
    const fresh = visible.filter((i) => !this.recentBreakLinks.includes(i));
    const different = visible.filter((i) => i !== this.recentBreakLinks.at(-1));
    const candidates = fresh.length
      ? fresh
      : different.length
        ? different
        : visible;
    const index = candidates[Math.floor(this.random() * candidates.length)];
    return index;
  }
  setDrag(target) {
    if (target === null) {
      this.current.simulation.endDrag();
      return;
    }
    if (!this.current.simulation.broken)
      this.current.simulation.dragTarget = target;
  }
  advance(
    dt,
    {
      auto = false,
      pulling = false,
      speed = 1,
      strength = 1,
      orbitSpeed = 2.5,
    } = {},
  ) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.accumulator += dt * speed;
    while (this.accumulator >= STEP - 1e-10) {
      this.time += STEP;
      this.orbitAngle =
        (this.orbitAngle + (STEP * orbitSpeed * Math.PI) / 180) % (Math.PI * 2);
      if (this.fractureAge >= 0) this.fractureAge += STEP;
      for (const shot of this.shots) {
        if (shot === this.next) continue;
        shot.simulation.strength = MINE_LINK_STRENGTH * strength;
        shot.simulation.advance(
          STEP,
          shot === this.current ? (pulling ? 2.7 : auto ? 1 : 0) : 0,
        );
      }
      this.callbacks.onAdvance(STEP);
      const shot = this.current,
        sim = shot.simulation;
      if (
        shot.stressLink === null &&
        !sim.fracture &&
        sim.controlled &&
        sim.slackRemaining < 0.12 &&
        sim.load > sim.strength * 0.35
      )
        shot.stressLink = sim.forcedWeakLink ?? this.chooseBreakLink(sim);
      if (sim.fractures.length > shot.reportedCracks) {
        shot.reportedCracks = sim.fractures.length;
        if (sim.pendingFracture) this.callbacks.onCrack(shot);
      }
      const completed = sim.fractures.filter(
        (f) => f.completeTime !== undefined,
      ).length;
      if (completed > shot.reportedBreaks) {
        this.recentBreakLinks = [
          ...this.recentBreakLinks,
          sim.fracture.index,
        ].slice(-2);
        shot.reportedBreaks = completed;
        this.fractureAge = 0;
        this.breaks++;
        this.callbacks.onBreak(shot);
      }
      if (sim.broken) {
        if (this.transitionAge < 0) this.transitionAge = 0;
        else this.transitionAge += STEP;
        const pose = this.cameraPose(),
          [, y, depth] = viewCoordinates(sim.mine.position, pose, shot.z),
          tan = Math.tan((pose.fov * Math.PI) / 360);
        // Wait until the entire departing shell has cleared the current view.
        if (
          this.transitionAge > 1 &&
          y > depth * tan + (MINE_RADIUS + 0.6) * Math.hypot(1, tan) + 0.25
        ) {
          // A prepared assembly stays asleep below the frame until the old
          // shell has left. Never build detailed geometry on this handoff.
          if (this.next && !this.next.ready) {
            this.accumulator -= STEP;
            continue;
          }
          this.index++;
          this.current = this.next || this.createShot(this.index);
          this.next = null;
          this.transitionAge = -1;
          this.fractureAge = -1;
        }
      }
      this.retire(STEP);
      this.accumulator -= STEP;
    }
  }
  cameraPose(aspect = this.getAspect()) {
    const d = distance(aspect);
    return {
      fov: cameraFov(aspect),
      azimuth: this.orbitAngle,
      x: Math.sin(this.orbitAngle) * d,
      y: -0.6,
      z: Math.cos(this.orbitAngle) * d,
      target: [0, -0.6, 0],
      distance: d,
      lightTarget: [0, -0.2, 0],
    };
  }

  retire(dt) {
    const pose = this.cameraPose(),
      aspect = this.getAspect(),
      tan = Math.tan((pose.fov * Math.PI) / 360);
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      if (shot === this.current || shot === this.next) continue;
      const outside = (body, radius) =>
        [body.position, body.previousPosition].every((p) => {
          const [x, y, depth] = viewCoordinates(p, pose, shot.z),
            h = Math.max(0, depth) * tan;
          return (
            depth < -radius ||
            Math.abs(y) > h + radius * Math.hypot(1, tan) ||
            Math.abs(x) > h * aspect + radius * Math.hypot(1, tan * aspect)
          );
        });
      const clear =
        outside(shot.simulation.mine, MINE_RADIUS + 0.6) &&
        [...shot.simulation.links, ...shot.simulation.fragments].every(
          (b) => !b || outside(b, 0.5),
        );
      shot.outsideTime = clear ? shot.outsideTime + dt : 0;
      if (shot.outsideTime < 1) continue;
      this.shots.splice(i, 1);
      this.callbacks.onRemove(shot);
      shot.simulation.dispose();
    }
  }
  inspect() {
    return {
      time: this.time,
      index: this.index,
      breaks: this.breaks,
      transitionAge: this.transitionAge,
      fractureAge: this.fractureAge,
      shots: this.shots.length,
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
