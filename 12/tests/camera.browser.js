import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { createCameraOrbit } from '../camera-orbit.js';
import { CAMERA } from '../scene-constants.js';
import { createSettings } from '../settings.js';

// Exercise real DOM input handlers on an isolated canvas. Synthetic pointer
// IDs have no browser capture, so only the capture calls are stubbed here.
export function checkCamera() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:-1000px;width:400px;height:300px';
  canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
  document.body.append(canvas);
  const classes = document.body.className;
  const camera = new PerspectiveCamera(CAMERA.fov, 4 / 3, CAMERA.near, CAMERA.far);
  const settings = createSettings();
  const orbit = createCameraOrbit(camera, canvas, () => {}, settings);
  const results = [];
  const check = (condition, label) => {
    if (!condition) throw new Error(label);
    results.push(label);
  };
  const input = (type, x, y, pointerType = 'mouse', pointerId = 81) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId, isPrimary: pointerId === 81, pointerType, button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, clientX: x, clientY: y,
  }));
  const settle = () => { for (let i = 0; i < 120; i++) orbit.update(1 / 60); };
  const direction = () => camera.getWorldDirection(new Vector3());
  try {
    const opening = camera.position.clone();
    check(Math.abs(opening.y - CAMERA.height) < 1e-8 && opening.y > CAMERA.minHeight,
      'Opening altitude leaves room to drag downward');
    settle();
    check(camera.position.distanceTo(opening) > .1, 'Auto orbit runs before a drag');
    check(settings.orbitSpeed === 6, 'Default auto orbit matches the 60-second video');
    for (const fps of [30, 60, 120]) {
      let angle = orbit.controls.getAzimuthalAngle(), total = 0;
      for (let i = 0; i < 60 * fps; i++) {
        orbit.update(1 / fps);
        const next = orbit.controls.getAzimuthalAngle();
        total += Math.atan2(Math.sin(next - angle), Math.cos(next - angle));
        angle = next;
      }
      // Damping carries at most a fraction of a degree across cadence changes.
      check(Math.abs(total - Math.PI * 2) < .02, `${fps} fps: one auto orbit per minute`);
    }
    for (const pointerType of ['mouse', 'touch']) {
      orbit.reset(); settings.paused = false;
      settle();
      input('pointerdown', 200, 150, pointerType);
      const before = camera.position.clone(), rotation = camera.quaternion.clone(), target = orbit.controls.target.clone();
      input('pointermove', 200, 240, pointerType); settle();
      check(camera.position.y > before.y + 1, `${pointerType}: dragging down raises the camera`);
      check(Math.hypot(camera.position.x - before.x, camera.position.z - before.z) < 1e-7, `${pointerType}: vertical drag keeps horizontal position`);
      check(camera.quaternion.angleTo(rotation) < 1e-7, `${pointerType}: vertical drag preserves the entire viewing angle`);
      check(Math.abs((camera.position.y - before.y) - (orbit.controls.target.y - target.y)) < 1e-7, `${pointerType}: target moves with camera height`);
      input('pointerup', 200, 240, pointerType);
      settings.paused = true; orbit.update(0);

      input('pointerdown', 200, 150, pointerType);
      const height = camera.position.y, viewY = direction().y, position = camera.position.clone();
      input('pointermove', 280, 150, pointerType); settle();
      check(camera.position.distanceTo(position) > .5, `${pointerType}: horizontal drag orbits while paused`);
      check(Math.abs(camera.position.y - height) < 1e-7 && Math.abs(direction().y - viewY) < 1e-7, `${pointerType}: horizontal drag preserves height and pitch`);
      input('pointerup', 280, 150, pointerType);

      input('pointerdown', 200, 150, pointerType);
      input('pointermove', 200, 10000, pointerType); settle();
      check(Math.abs(camera.position.y - CAMERA.maxHeight) < 1e-6, `${pointerType}: upper height limit`);
      input('pointermove', 200, -10000, pointerType); settle();
      check(Math.abs(camera.position.y - CAMERA.minHeight) < 1e-6, `${pointerType}: lower height limit`);
      input('pointercancel', 200, -10000, pointerType);
      check(!document.body.classList.contains('orbiting'), `${pointerType}: cancellation ends the drag`);
      settings.paused = false;
      const cancelled = camera.position.clone(); settle();
      check(camera.position.distanceTo(cancelled) > .1, `${pointerType}: auto orbit resumes after release`);
    }
    orbit.reset();
    check(camera.position.distanceTo(opening) < 1e-8, 'Reset restores opening height and azimuth');
    const distance = () => camera.position.distanceTo(orbit.controls.target);
    check(Math.abs(distance() - CAMERA.radius) < 1e-8, 'Reset restores the opening orbit distance');
    settings.paused = true;
    const wheel = (deltaY, ctrlKey = false) => canvas.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, clientX: 200, clientY: 150, deltaY, ctrlKey,
    }));
    const rotation = camera.quaternion.clone(), height = camera.position.y;
    wheel(-120); settle();
    check(distance() < CAMERA.radius, 'Scrolling up zooms in while paused');
    check(Math.abs(camera.position.y - height) < 1e-7 && camera.quaternion.angleTo(rotation) < 1e-7, 'Wheel zoom preserves height and viewing angle');
    check(Math.abs(settings.focus - distance()) < 1e-7, 'Focus follows the centered subjects during zoom');
    const previousDistance = distance(); wheel(30, true); settle();
    check(distance() > previousDistance, 'Trackpad pinch wheel events zoom out');
    settings.focus = distance() + 1.25;
    wheel(-120); settle();
    check(Math.abs(settings.focus - distance() - 1.25) < 1e-7, 'Zoom preserves a manually selected focus offset');
    for (let i = 0; i < 40; i++) wheel(-1000);
    settle();
    check(Math.abs(distance() - CAMERA.minDistance) < 1e-7, 'Zoom-in distance limit');
    for (let i = 0; i < 40; i++) wheel(1000);
    settle();
    check(Math.abs(distance() - CAMERA.maxDistance) < 1e-7, 'Zoom-out distance limit');
    check(Math.abs(camera.position.y - height) < 1e-7, 'Zoom limits retain camera altitude');
    orbit.reset(); settings.focus = CAMERA.radius;
    check(camera.position.distanceTo(opening) < 1e-8, 'Reset after zoom restores the opening camera');

    input('pointerdown', 160, 150, 'touch');
    input('pointerdown', 240, 150, 'touch', 82);
    input('pointermove', 120, 110, 'touch');
    input('pointermove', 280, 190, 'touch', 82); settle();
    check(distance() < CAMERA.radius, 'Spreading two fingers zooms in');
    check(Math.abs(camera.position.y - height) < 1e-7 && camera.quaternion.angleTo(rotation) < 1e-7, 'Pinching changes neither altitude nor rotation');
    const pinchedDistance = distance();
    input('pointermove', 160, 150, 'touch');
    input('pointermove', 240, 150, 'touch', 82); settle();
    check(distance() > pinchedDistance, 'Closing two fingers zooms out');
    input('pointerup', 160, 150, 'touch');
    input('pointermove', 240, 210, 'touch', 82); settle();
    check(camera.position.y > height + .5, 'Remaining finger resumes vertical drag after a pinch');
    input('pointercancel', 240, 210, 'touch', 82);
    check(!document.body.classList.contains('orbiting'), 'Canceling a pinch sequence releases input');
    settings.paused = false;
    const afterPinch = camera.position.clone(); settle();
    check(camera.position.distanceTo(afterPinch) > .1, 'Auto orbit resumes after zoom gestures');
    return { passed: results.length, results };
  } finally { orbit.dispose(); canvas.remove(); document.body.className = classes; }
}
