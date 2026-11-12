export const FPS = 30;
export const SIZE = 1024;
export const DURATION = 46;
export const TOTAL_FRAMES = DURATION * FPS;
export const LOOP_BLEND_FRAMES = 24;
export const SEED = 11;
export const GRAB_TIME = 8.7;
export const SWING_DURATION = 7.2;

const smoothstep = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

// Drive the same grabbed-point spring as pointer input. Each mine follows a
// gentle sideways/downward arc before a slow upward pull loads its tether.
export function createDragSequence() {
  let index = -1,
    grabbedAt = null,
    origin = null,
    reportedBreak = false;
  const events = [];
  return {
    events,
    update(journey) {
      const shot = journey.current,
        sim = shot.simulation;
      if (shot.index !== index) {
        index = shot.index;
        grabbedAt = null;
        reportedBreak = false;
        events.push({ type: "arrival", mine: index, time: journey.time });
      }
      if (sim.broken) {
        // Hold the third entrance below the frame while the final loose metal
        // clears the view. The loop supplies the next mine's entrance.
        if (index === 1) journey.prepareNext().ready = false;
        if (!reportedBreak) {
          events.push({
            type: "break",
            mine: index,
            time: journey.time,
            link: sim.fracture.index,
          });
          reportedBreak = true;
        }
        return;
      }
      if (index >= 2 || sim.time < GRAB_TIME) return;
      const angle = journey.orbitAngle;
      if (grabbedAt === null) {
        grabbedAt = sim.time;
        origin = [...sim.mine.position];
        sim.beginDrag([
          origin[0] + Math.sin(angle) * 1.2,
          origin[1] + 0.25,
          origin[2] + Math.cos(angle) * 1.2,
        ]);
        events.push({ type: "grab", mine: index, time: journey.time });
      }
      const t = sim.time - grabbedAt,
        direction = index % 2 ? -1 : 1;
      let x, y;
      if (t < SWING_DURATION) {
        const u = t / SWING_DURATION;
        x = direction * 2.6 * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u);
        y = origin[1] - 1.25 * Math.sin(Math.PI * u) ** 2;
      } else {
        const u = smoothstep((t - SWING_DURATION) / 3);
        x = direction * 0.1 * u;
        y = origin[1] + 3.2 * u;
      }
      sim.dragTarget = [Math.cos(angle) * x, y, -Math.sin(angle) * x];
    },
  };
}
