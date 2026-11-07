import * as THREE from "three/webgpu";
import { PLANETS, PINION_TEETH, orbitAngle, wrappedDelta } from "./motion.js";

export function createWinding({
  canvas,
  camera,
  controls,
  orrery,
  clock,
  changed,
}) {
  const abort = new AbortController(),
    signal = abort.signal;
  const raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  raycaster.layers.enable(1);
  const projected = new THREE.Vector3();
  const dragPosition = new THREE.Vector2(),
    hoverPosition = new THREE.Vector2(),
    orbitPoint = new THREE.Vector2(),
    before = new THREE.Vector2(),
    after = new THREE.Vector2();
  let active = null,
    hovered = null,
    pointerInside = false,
    pointerId = null,
    lastTime = 0,
    velocity = 0,
    lastMove = 0;
  function cast(x, y) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      1 - ((y - rect.top) / rect.height) * 2,
    );
    camera.updateMatrixWorld();
    orrery.group.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
  }
  function pick(x, y) {
    cast(x, y);
    const hit = raycaster.intersectObjects(orrery.targets, false)[0];
    if (hit) return hit.object.userData.planet;
    // A small screen-space allowance makes the miniature planets touchable.
    const rect = canvas.getBoundingClientRect();
    let best = 22,
      result = null;
    for (const body of orrery.targets) {
      body.getWorldPosition(projected).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const distance = Math.hypot(
        (projected.x * 0.5 + 0.5) * rect.width + rect.left - x,
        (-projected.y * 0.5 + 0.5) * rect.height + rect.top - y,
      );
      if (distance < best) {
        best = distance;
        result = body.userData.planet;
      }
    }
    return result;
  }
  function setHovered(object) {
    if (hovered === object) return;
    if (hovered) hovered.userData.isHovered = false;
    hovered = object;
    if (hovered) hovered.userData.isHovered = true;
    changed();
  }
  function updateHover() {
    if (!pointerInside) return;
    const index = pick(hoverPosition.x, hoverPosition.y);
    const object = index !== null ? orrery.planets[index].body : null;
    setHovered(object);
    canvas.style.cursor = index !== null ? "ew-resize" : "grab";
  }
  function projectOrbit(index, a, result, rect) {
    const r = PLANETS[index].orbit;
    projected
      .set(Math.cos(a) * r, orrery.planets[index].y, -Math.sin(a) * r)
      .applyMatrix4(orrery.group.matrixWorld)
      .project(camera);
    return result.set(
      rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    );
  }
  function projectedDelta(x, y) {
    const rect = canvas.getBoundingClientRect(),
      start = orbitAngle(active, clock.windingClock);
    const epsilon = 0.0005;
    let a = start;
    // Solve the projected orbit curve. A single tangent step accumulates error
    // at low elevations, especially near the ends of the apparent ellipse.
    for (let i = 0; i < 8; i++) {
      projectOrbit(active, a, orbitPoint, rect);
      projectOrbit(active, a - epsilon, before, rect);
      projectOrbit(active, a + epsilon, after, rect);
      const tx = (after.x - before.x) / (2 * epsilon),
        ty = (after.y - before.y) / (2 * epsilon),
        length2 = tx * tx + ty * ty;
      if (length2 < 0.001) break;
      const step = THREE.MathUtils.clamp(
        ((x - orbitPoint.x) * tx + (y - orbitPoint.y) * ty) / length2,
        -0.15,
        0.15,
      );
      a += step;
      if (Math.abs(step) < 0.000001) break;
    }
    return wrappedDelta(a, start);
  }
  // Reproject the held target after camera movement, even when the pointer is
  // stationary. The actual carriers still ease toward this target in Clockwork.
  function update() {
    if (active === null) {
      updateHover();
      return 0;
    }
    camera.updateMatrixWorld();
    const delta = THREE.MathUtils.clamp(
      projectedDelta(dragPosition.x, dragPosition.y),
      -0.4,
      0.4,
    );
    if (Math.abs(delta) > 1e-8) {
      clock.turn(active, delta);
      changed();
    }
    return delta;
  }
  function end(event) {
    if (active === null || (event && event.pointerId !== pointerId)) return;
    const cancelled =
      !event ||
      event.type === "pointercancel" ||
      event.type === "lostpointercapture";
    if (!cancelled && performance.now() - lastMove < 100)
      clock.release(velocity);
    clock.endTurn(cancelled);
    controls.enabled = true;
    orrery.planets[active].body.userData.isDragged = false;
    const id = pointerId;
    active = null;
    pointerId = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    if (cancelled) {
      pointerInside = false;
      setHovered(null);
    } else updateHover();
    changed();
  }
  function cancel() {
    end();
    pointerInside = false;
    setHovered(null);
  }
  // Capture before OrbitControls handles the same pointerdown.
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      pointerInside = event.pointerType !== "touch";
      hoverPosition.set(event.clientX, event.clientY);
      if (!pointerInside) setHovered(null);
      const index = pick(event.clientX, event.clientY);
      if (index === null) return;
      const object = orrery.planets[index].body;
      active = index;
      if (pointerInside) setHovered(object);
      object.userData.isDragged = true;
      pointerId = event.pointerId;
      dragPosition.set(event.clientX, event.clientY);
      controls.enabled = false;
      clock.beginTurn();
      lastTime = performance.now();
      lastMove = 0;
      velocity = 0;
      canvas.setPointerCapture(pointerId);
      canvas.focus({ preventScroll: true });
      event.preventDefault();
      event.stopImmediatePropagation();
      changed();
    },
    { signal, capture: true },
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      pointerInside = event.pointerType !== "touch";
      hoverPosition.set(event.clientX, event.clientY);
      if (active === null) {
        updateHover();
        return;
      }
      if (event.pointerId !== pointerId) return;
      dragPosition.set(event.clientX, event.clientY);
      const delta = update();
      const now = performance.now(),
        dt = Math.max(0.008, (now - lastTime) / 1000);
      velocity = THREE.MathUtils.lerp(
        velocity,
        ((delta / dt) * PLANETS[active].teeth) / PINION_TEETH,
        0.4,
      );
      lastTime = now;
      lastMove = now;
      changed();
    },
    { signal },
  );
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    canvas.addEventListener(name, end, { signal });
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointerInside = false;
      setHovered(null);
    },
    { signal },
  );
  window.addEventListener("blur", cancel, { signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) cancel();
    },
    { signal },
  );
  return {
    pick,
    update,
    cancel,
    dispose() {
      cancel();
      abort.abort();
    },
  };
}
