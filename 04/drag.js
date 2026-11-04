import { Raycaster, Vector2, Vector3, Plane } from 'three/webgpu';

// Pick the simulated centerline in screen space: the visible geometry lives on
// the GPU, so a conventional CPU triangle raycast would hit undeformed plies.
export function addDragging(canvas, camera, simulation, controls, onChange) {
  if (simulation.isGPU) return addGPUDragging(canvas, camera, simulation, controls, onChange);
  const raycaster = new Raycaster(),
    pointer = new Vector2(),
    projected = new Vector3();
  const plane = new Plane(),
    point = new Vector3(),
    offset = new Vector3(),
    normal = new Vector3();
  const abort = new AbortController();
  let active = null;
  const listen = (target, type, fn, options = {}) =>
    target.addEventListener(type, fn, { ...options, signal: abort.signal });
  function pick(x, y) {
    const rect = canvas.getBoundingClientRect(),
      p = simulation.positions;
    camera.updateMatrixWorld();
    let best = -1,
      score = Infinity;
    for (let i = 0; i < simulation.total; i++) {
      const n = i % simulation.count;
      if (n < 4 || n > simulation.active[Math.floor(i / simulation.count)] - 4) continue;
      projected.fromArray(p, i * 3).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const dx = (projected.x * 0.5 + 0.5) * rect.width + rect.left - x;
      const dy = (-projected.y * 0.5 + 0.5) * rect.height + rect.top - y;
      const d = Math.hypot(dx, dy);
      if (d > 16) continue;
      // Prefer the front strand at crossings, with distance as a tiebreaker.
      const candidate = projected.z + d * 0.0003;
      if (candidate < score) {
        score = candidate;
        best = i;
      }
    }
    return best;
  }
  function updateRay(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    raycaster.setFromCamera(pointer, camera);
  }
  function end(event) {
    if (active === null) return;
    if (event?.pointerId !== undefined && event.pointerId !== active) return;
    if (canvas.hasPointerCapture(active)) canvas.releasePointerCapture(active);
    active = null;
    simulation.endGrab();
    controls.enabled = true;
    onChange();
  }
  listen(
    canvas,
    'pointerdown',
    event => {
      if (event.button !== 0 || active !== null) return;
      const index = pick(event.clientX, event.clientY);
      if (index < 0) return;
      controls.enabled = false;
      event.stopImmediatePropagation();
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      point.fromArray(simulation.positions, index * 3);
      camera.getWorldDirection(normal);
      plane.setFromNormalAndCoplanarPoint(normal, point);
      updateRay(event);
      const hit = raycaster.ray.intersectPlane(plane, new Vector3());
      if (!hit) {
        controls.enabled = true;
        return;
      }
      offset.copy(point).sub(hit);
      simulation.beginGrab(index, point.toArray());
      active = event.pointerId;
      canvas.setPointerCapture(active);
      onChange();
    },
    { capture: true }
  );
  listen(canvas, 'pointermove', event => {
    if (active !== event.pointerId) return;
    updateRay(event);
    if (raycaster.ray.intersectPlane(plane, point)) {
      point.add(offset);
      point.y = Math.max(0.08, Math.min(6.5, point.y));
      point.x = Math.max(-6, Math.min(6, point.x));
      point.z = Math.max(-6, Math.min(6, point.z));
      simulation.moveGrab(point.toArray());
      onChange();
    }
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, name, end);
  listen(window, 'blur', () => end());
  listen(document, 'visibilitychange', () => end());
  return {
    pick,
    end,
    dispose() {
      end();
      abort.abort();
    }
  };
}

function addGPUDragging(canvas, camera, simulation, controls, onChange) {
  const raycaster = new Raycaster(),
    pointer = new Vector2(),
    plane = new Plane();
  const point = new Vector3(),
    offset = new Vector3(),
    normal = new Vector3();
  const abort = new AbortController();
  let active = null,
    pending = null,
    forwarding = false,
    disposed = false;
  const orbitPointers = new Set();
  const listen = (target, type, callback, options = {}) =>
    target.addEventListener(type, callback, { ...options, signal: abort.signal });
  const eventData = event => ({
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    bubbles: true,
    cancelable: true
  });
  const forward = (type, data) => {
    forwarding = true;
    try {
      canvas.dispatchEvent(new PointerEvent(type, data));
    } finally {
      forwarding = false;
    }
  };
  async function pick(x, y) {
    const rect = canvas.getBoundingClientRect();
    return simulation.pick(x - rect.left, y - rect.top, camera, rect.width, rect.height);
  }
  function updateRay(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    raycaster.setFromCamera(pointer, camera);
  }
  function move(event) {
    updateRay(event);
    if (!raycaster.ray.intersectPlane(plane, point)) return;
    point.add(offset);
    point.y = Math.max(0.08, Math.min(6.5, point.y));
    point.x = Math.max(-6, Math.min(6, point.x));
    point.z = Math.max(-6, Math.min(6, point.z));
    simulation.moveGrab(point.toArray());
    onChange();
  }
  function end(event) {
    if (event?.pointerId !== undefined) orbitPointers.delete(event.pointerId);
    else orbitPointers.clear();
    const id = active ?? pending?.down.pointerId;
    if (id === undefined || id === null) return;
    if (event?.pointerId !== undefined && event.pointerId !== id) return;
    active = null;
    pending = null;
    simulation.endGrab();
    controls.enabled = true;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    onChange();
  }
  listen(
    canvas,
    'pointerdown',
    event => {
      if (forwarding) return;
      // Once a background orbit has begun, let OrbitControls receive additional
      // fingers directly so its normal two-finger pinch gesture remains intact.
      if (orbitPointers.size) {
        orbitPointers.add(event.pointerId);
        return;
      }
      if (event.button !== 0 || active !== null || pending) return;
      // Hold OrbitControls for the one asynchronous pick. A missed pick is
      // forwarded to its normal pointer handlers, preserving background orbit.
      event.stopImmediatePropagation();
      event.preventDefault();
      controls.enabled = false;
      const request = { down: eventData(event), move: eventData(event) };
      pending = request;
      canvas.setPointerCapture(event.pointerId);
      pick(event.clientX, event.clientY)
        .then(hit => {
          if (disposed || pending !== request) return;
          pending = null;
          if (!hit) {
            controls.enabled = true;
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
            orbitPointers.add(event.pointerId);
            forward('pointerdown', request.down);
            if (request.move.clientX !== request.down.clientX || request.move.clientY !== request.down.clientY)
              forward('pointermove', request.move);
            return;
          }
          point.fromArray(hit.position);
          camera.getWorldDirection(normal);
          plane.setFromNormalAndCoplanarPoint(normal, point);
          updateRay(request.down);
          const intersection = raycaster.ray.intersectPlane(plane, new Vector3());
          if (!intersection) {
            controls.enabled = true;
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
            return;
          }
          offset.copy(point).sub(intersection);
          simulation.beginGrab(hit.index, hit.position, hit.travel);
          active = event.pointerId;
          canvas.focus({ preventScroll: true });
          move(request.move);
        })
        .catch(error => {
          if (!disposed) {
            end();
            console.error('Yarn picking:', error);
          }
        });
    },
    { capture: true }
  );
  listen(canvas, 'pointermove', event => {
    if (forwarding) return;
    if (pending?.down.pointerId === event.pointerId) {
      pending.move = eventData(event);
      return;
    }
    if (active === event.pointerId) move(event);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, name, end);
  listen(window, 'blur', () => end());
  listen(document, 'visibilitychange', () => end());
  return {
    pick,
    end,
    dispose() {
      disposed = true;
      end();
      abort.abort();
    }
  };
}
