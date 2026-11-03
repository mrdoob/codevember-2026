import { Frustum, Matrix4, Vector3 } from 'three/webgpu';

// Move camera, orbit target, and launch point together. Existing rigid bodies
// remain in world space as the camera advances over their settled fragments.
export class CameraJourney {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.launchPoint = new Vector3();
    this.direction = new Vector3();
    this.viewDirection = new Vector3();
    this.frustum = new Frustum();
    this.viewProjection = new Matrix4();
  }
  spawnHeight(radius, minimumHeight) {
    this.camera.updateMatrixWorld(true);
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection, this.camera.coordinateSystem);
    const top = this.frustum.planes[3];
    // Put the entire bounding sphere beyond the top plane. A sphere covers
    // every starting orientation and spin, with a small gap before entry.
    const height = (-radius - 0.25 - top.constant - top.normal.x * this.launchPoint.x - top.normal.z * this.launchPoint.z) / top.normal.y;
    return Math.max(minimumHeight, height);
  }
  advance(delta, speed) {
    this.direction.subVectors(this.controls.target, this.camera.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) this.direction.set(0, 0, -1);
    const offset = this.direction.normalize().multiplyScalar(delta * speed);
    this.camera.position.add(offset);
    this.controls.target.add(offset);
    this.launchPoint.add(offset);
  }
  reset() {
    this.camera.position.sub(this.launchPoint);
    this.controls.target.sub(this.launchPoint);
    this.launchPoint.set(0, 0, 0);
  }
  outOfRange(body, distance = 58) {
    const positions = body.broken ? body.fragments : [body];
    const forward = this.camera.getWorldDirection(this.viewDirection);
    const radius = part => {
      const bounds = (part.geometry || part.meshes?.[0]?.geometry)?.boundingSphere;
      return bounds ? bounds.radius + bounds.center.length() : 2;
    };
    const passed = positions.every(part => part.position.clone().sub(this.camera.position).dot(forward) < -radius(part) - 0.5);
    return passed || positions.every(part => part.position.distanceTo(this.camera.position) > distance + radius(part));
  }
}
