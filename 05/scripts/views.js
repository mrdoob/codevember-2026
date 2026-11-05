import { Vector3 } from 'three/webgpu';

export function setMacroView(app, index = 0, rear = false) {
  const rock = app.garden.rocks[index];
  app.garden.update(app.materials.time.value);
  const direction = rear ? -1 : 1;
  const target = rock.bundle.localToWorld(new Vector3(.1, 1.65, .65 * direction));
  const eye = rock.bundle.localToWorld(new Vector3(.1, 2.4, 2.7 * direction));
  app.camera.position.copy(eye); app.controls.target.copy(target);
  app.controls.update(); app.focusPoint.copy(target);
}
