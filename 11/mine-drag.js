import {
  MathUtils,
  Plane,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
} from "three/webgpu";

// Keep the grab plane facing the orbiting camera, with the picked surface
// point as the lever arm used by the mine's physics.
export function createMineDrag({
  canvas,
  camera,
  getShot,
  onStart,
  onEnd,
  signal,
}) {
  const raycaster = new Raycaster(),
    plane = new Plane(),
    pointerNdc = new Vector2(),
    dragPointerNdc = new Vector2(),
    hitPoint = new Vector3(),
    origin = new Vector3(),
    offset = new Vector3(),
    normal = new Vector3(),
    right = new Vector3(),
    planePoint = new Vector3(),
    pickSphere = new Sphere();
  let shot = null,
    pointer = null,
    depth = 0;

  function pointRay(event) {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    raycaster.setFromCamera(pointerNdc, camera);
  }

  function update() {
    if (!shot || shot.simulation.broken) return;
    camera.getWorldDirection(normal);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    planePoint.copy(camera.position).addScaledVector(normal, depth);
    plane.setFromNormalAndCoplanarPoint(normal, planePoint);
    raycaster.setFromCamera(dragPointerNdc, camera);
    if (raycaster.ray.intersectPlane(plane, hitPoint)) {
      hitPoint.sub(origin).add(offset);
      const sideways = hitPoint.dot(right);
      hitPoint.addScaledVector(
        right,
        MathUtils.clamp(sideways, -3.2, 3.2) - sideways,
      );
      hitPoint.y = Math.min(hitPoint.y, 6);
      shot.simulation.dragTarget = hitPoint.toArray();
    }
  }

  function begin(event) {
    if (
      event.button !== 0 ||
      pointer !== null ||
      (event.pointerType === "touch" && !event.isPrimary)
    )
      return;
    const current = getShot();
    if (current.simulation.broken) return;
    pointRay(event);
    pickSphere.center.copy(current.mineVisual.group.position);
    pickSphere.radius = 1.8;
    if (!raycaster.ray.intersectsSphere(pickSphere)) return;
    const surface = raycaster.intersectObjects(
      current.mineVisual.meshes,
      false,
    )[0];
    if (!surface) return;
    shot = current;
    camera.getWorldDirection(normal);
    depth = surface.point.clone().sub(camera.position).dot(normal);
    origin.copy(surface.point);
    dragPointerNdc.copy(pointerNdc);
    offset.fromArray(shot.simulation.mine.position);
    shot.simulation.beginDrag(
      surface.point
        .clone()
        .sub(new Vector3(0, 0, shot.z))
        .toArray(),
    );
    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    onStart();
  }

  function release() {
    const id = pointer;
    // Clear state first: releasing capture can dispatch lostpointercapture.
    pointer = null;
    shot?.simulation.endDrag();
    shot = null;
    if (id !== null && canvas.hasPointerCapture(id))
      canvas.releasePointerCapture(id);
    onEnd();
  }

  function move(event) {
    pointRay(event);
    if (shot && pointer === event.pointerId) {
      dragPointerNdc.copy(pointerNdc);
      update();
    } else if (pointer === null) {
      const current = getShot();
      pickSphere.center.copy(current.mineVisual.group.position);
      pickSphere.radius = 1.8;
      canvas.style.cursor =
        !current.simulation.broken && raycaster.ray.intersectsSphere(pickSphere)
          ? "grab"
          : "default";
    }
  }

  function end(event) {
    if (pointer === event.pointerId) release();
  }

  const events = { signal };
  canvas.addEventListener("pointermove", move, events);
  canvas.addEventListener("pointerdown", begin, events);
  canvas.addEventListener("pointerup", end, events);
  canvas.addEventListener("pointercancel", end, events);
  canvas.addEventListener("lostpointercapture", end, events);
  return {
    update,
    release,
    get shot() {
      return shot;
    },
  };
}
