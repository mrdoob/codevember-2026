import { Vector3 } from "three/webgpu";
import { GRAB_TIME } from "./capture-sequence.js";

const smoothstep = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

// Recording-only gesture indicator. Follow the requested grab point, including
// its lever arm, so pulling away from the heavy shell remains visible.
export function createCapturePointer(size) {
  const target = new Vector3(),
    offset = new Vector3();
  let index = -1,
    last = null;
  function project(point, camera) {
    point.project(camera);
    return { x: (point.x * 0.5 + 0.5) * size, y: (0.5 - point.y * 0.5) * size };
  }
  function clear() {
    index = -1;
    last = null;
  }
  return {
    clear,
    get state() {
      return last;
    },
    draw(ctx, journey, camera) {
      const shot = journey.current,
        sim = shot.simulation;
      if (shot.index !== index) {
        clear();
        index = shot.index;
      }
      let point,
        opacity = 1,
        held = false,
        release = 0,
        press = 0;
      if (sim.broken) {
        release = journey.fractureAge / 0.45;
        if (!last || release >= 1) {
          last = null;
          return;
        }
        point = last.point;
        opacity = 1 - smoothstep(release);
      } else if (sim.dragTarget && sim.grabOffset) {
        held = true;
        target.fromArray(sim.dragTarget).add(offset.fromArray(sim.grabOffset));
        target.z += shot.z;
        point = project(target, camera);
        press = Math.max(0, 1 - (sim.time - GRAB_TIME) / 0.25);
      } else {
        const age = sim.time - (GRAB_TIME - 0.9);
        if (index >= 2 || age < 0) {
          last = null;
          return;
        }
        const ease = smoothstep(age / 0.9),
          angle = journey.orbitAngle;
        target.fromArray(sim.mine.position);
        target.x += Math.sin(angle) * 1.2;
        target.y += 0.25;
        target.z += Math.cos(angle) * 1.2 + shot.z;
        point = project(target, camera);
        point.x += (1 - ease) * 80;
        point.y += (1 - ease) * 65;
        opacity = smoothstep(age / 0.2);
      }
      // Pointer capture can continue beyond the image. Keep the gesture visible
      // at its edge until the tether releases, then expand and fade the circle.
      const x = Math.max(24, Math.min(size - 24, point.x)),
        y = Math.max(24, Math.min(size - 24, point.y)),
        radius = held ? 9 + press * 4 : release > 0 ? 9 + release * 16 : 13;
      last = { point, held, opacity, x, y, radius };
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 4;
      ctx.fillStyle = held ? "rgba(235,250,255,0.2)" : "rgba(235,250,255,0.02)";
      ctx.strokeStyle = "rgba(235,250,255,0.9)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  };
}
