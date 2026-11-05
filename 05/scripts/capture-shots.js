import { Raycaster, Vector2 } from 'three/webgpu';
import { cameraLiftProgress } from '../floating-rocks.js';
import { smootherstep } from '../random.js';

const lerp = (a, b, t) => a + (b - a) * t;

export const SHOT_PLAN = [
  { start: 0, end: 17, name: 'Rise and first nudges', target: [0, 2.1, 0], distance: [8, 7.3], elevation: [12, 16], azimuth: .24, orbit: .055 },
  { start: 17, end: 28, name: 'Moss close-up', target: [0, 2.65, 0], distance: [2.25, 1.95], elevation: [28, 35], azimuth: .15, orbit: .04 },
  { start: 28, end: 40, name: '30-degree downward orbit and nudges', target: [0, 2.1, 0], distance: [8, 7.6], elevation: [30, 30], azimuth: -.95, orbit: .05 },
  { start: 40, end: 50, name: '75-degree polar orbit and meshlets', target: [0, 2.15, 0], distance: [6.8, 6.3], elevation: [15, 15], azimuth: 1.8, orbit: .045 },
  { start: 50, end: 60, name: 'Final moss macro detail', target: [0, 2.65, 0], distance: [1.15, .85], elevation: [36, 43], azimuth: 2.7, orbit: .04 }
];
export const MESHLET_INTERVAL = [44, 48];

export function captureShotAt(time) {
  return SHOT_PLAN.find(shot => time < shot.end) ?? SHOT_PLAN.at(-1);
}

export function setCaptureCamera(app, time) {
  const shot = captureShotAt(time), progress = smootherstep(shot.start, shot.end, time);
  const angle = shot.azimuth + shot.orbit * (time - shot.start);
  const distance = lerp(...shot.distance, progress), elevation = lerp(...shot.elevation, progress) * Math.PI / 180;
  const radius = Math.cos(elevation) * distance;
  const hero = app.garden.rocks[0].layout;
  const opening = -(hero.center[1] - hero.groundY) * (1 - cameraLiftProgress(time));
  app.controls.target.fromArray(shot.target); app.controls.target.y += opening;
  app.camera.position.set(Math.sin(angle) * radius, Math.sin(elevation) * distance, Math.cos(angle) * radius).add(app.controls.target);
  app.camera.lookAt(app.controls.target); app.camera.updateMatrixWorld(); app.focusPoint.copy(app.controls.target);
  app.settings.meshlets = time >= MESHLET_INTERVAL[0] && time < MESHLET_INTERVAL[1];
  return shot;
}

export const PRESS_PLAN = [
  { time: 9, rock: 0 }, { time: 13, rock: 1 },
  { time: 31, rock: 2 }, { time: 35, rock: 0 }
];

// Pick a visible part of the requested stone, using the same occluders as the
// live handler. This avoids tapping a companion hidden behind the main rock.
export function findCaptureTap(app, press, size) {
  const rock = app.garden.rocks[press.rock], projected = rock.pivot.position.clone().project(app.camera);
  const picker = new Raycaster(), ndc = new Vector2();
  const surfaces = [...app.garden.focusSurfaces, ...app.habitat.woodland.focusSurfaces].filter(object => object.visible);
  for (const [dx, dy] of [[0, .025], [0, 0], [-.025, 0], [.025, 0], [0, -.025], [-.04, .035], [.04, .035]]) {
    ndc.set(projected.x + dx, projected.y + dy);
    if (Math.abs(ndc.x) > .86 || ndc.y < -.84 || ndc.y > .69 || projected.z < 0 || projected.z > 1) continue;
    picker.setFromCamera(ndc, app.camera);
    const hit = picker.intersectObjects(surfaces, false)[0];
    if (hit && (hit.object === rock.stone || hit.object === rock.bed))
      return { x: (ndc.x * .5 + .5) * size, y: (.5 - ndc.y * .5) * size };
  }
  throw new Error(`Rock ${press.rock + 1} is not visibly tappable at ${press.time}s`);
}
