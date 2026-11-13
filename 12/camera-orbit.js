import { MathUtils, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA } from './scene-constants.js';

export function createCameraOrbit(camera, canvas, changed, settings) {
  const controls = new OrbitControls(camera, canvas);
  const polar = MathUtils.degToRad(90 - CAMERA.elevation);
  controls.target.set(0, CAMERA.height - CAMERA.radius * Math.cos(polar), 0);
  controls.enableDamping = true;
  controls.dampingFactor = .085;
  controls.rotateSpeed = .55;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.zoomSpeed = .8;
  controls.minDistance = CAMERA.minDistance;
  controls.maxDistance = CAMERA.maxDistance;
  controls.minPolarAngle = controls.maxPolarAngle = polar;
  camera.position.setFromSphericalCoords(CAMERA.radius, polar, 0).add(controls.target);
  controls.update();
  controls.saveState();
  let dragging = false, resetting = false, heightGoal = CAMERA.height;
  let distance = CAMERA.radius;
  const pointers = new Map();
  const abort = new AbortController(), events = { signal: abort.signal, capture: true };
  const change = () => {
    const nextDistance = camera.position.distanceTo(controls.target);
    const delta = nextDistance - distance;
    if (Math.abs(delta) > 1e-8) {
      // Dolly horizontally at the current height, retaining the viewing angle.
      if (!resetting) {
        const shift = -delta * Math.cos(polar);
        camera.position.y += shift; controls.target.y += shift;
      }
      // Keep the orbit center in focus, preserving any manual focus offset.
      settings.focus = Math.max(.1, settings.focus + delta);
      distance = nextDistance;
    }
    changed();
  };
  const heldPosition = new Vector3();
  const stopRotation = () => {
    heldPosition.copy(camera.position);
    controls.autoRotate = false; controls.enableDamping = false;
    controls.update(0); camera.position.copy(heldPosition); controls.update(0);
    controls.enableDamping = true;
  };
  const start = () => {
    stopRotation();
    dragging = true;
    heightGoal = camera.position.y;
    document.body.classList.add('orbiting');
  };
  const end = () => { dragging = false; pointers.clear(); document.body.classList.remove('orbiting'); };
  canvas.addEventListener('pointerdown', event => {
    if (!controls.enabled || event.button !== 0) return;
    pointers.set(event.pointerId, event.clientY);
  }, events);
  canvas.ownerDocument.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const lastY = pointers.get(event.pointerId);
    pointers.set(event.pointerId, event.clientY);
    if (!dragging || pointers.size !== 1 || !controls.enabled) return;
    // Use CSS pixels so sensitivity is independent of DPR. Drag down to rise.
    const unitsPerPixel = 2 * distance * Math.tan(MathUtils.degToRad(camera.fov / 2)) / Math.max(1, canvas.clientHeight);
    heightGoal = MathUtils.clamp(heightGoal + (event.clientY - lastY) * unitsPerPixel, CAMERA.minHeight, CAMERA.maxHeight);
  }, events);
  const release = event => pointers.delete(event.pointerId);
  canvas.ownerDocument.addEventListener('pointerup', release, events);
  canvas.ownerDocument.addEventListener('pointercancel', release, events);
  controls.addEventListener('change', change);
  controls.addEventListener('start', start);
  controls.addEventListener('end', end);
  return {
    controls,
    update(dt = 0) {
      const automatic = settings.autoOrbit && !settings.paused && !dragging;
      if (controls.autoRotate && !automatic && !dragging) {
        // Stop automatic momentum without changing the visible viewpoint.
        stopRotation();
      }
      controls.autoRotate = automatic;
      controls.autoRotateSpeed = -settings.orbitSpeed / 6;
      controls.update(dt);
      const shift = (heightGoal - camera.position.y) * (1 - Math.exp(-12 * dt));
      if (Math.abs(shift) > 1e-8) {
        // Translate both ends of the viewing direction, preserving pitch.
        camera.position.y += shift; controls.target.y += shift;
        changed();
      }
    },
    reset() {
      // Consume remaining drag momentum before restoring the saved view.
      controls.enableDamping = false;
      controls.autoRotate = false;
      controls.update(0);
      resetting = true; controls.reset(); resetting = false;
      controls.enableDamping = true;
      heightGoal = CAMERA.height;
      end();
    },
    dispose() {
      abort.abort();
      controls.removeEventListener('change', change);
      controls.removeEventListener('start', start);
      controls.removeEventListener('end', end);
      controls.dispose(); end();
    },
  };
}
