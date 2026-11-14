import { Vector3 } from 'three/webgpu';
import { PLAN } from './maze-plan.js';
import { PLAN_SCALE, grid } from './maze.js';

export function createMinimap(canvas) {
  const scale = 4, context = canvas.getContext('2d'), direction = new Vector3();
  const background = document.createElement('canvas');
  canvas.width = background.width = PLAN[0].length * scale;
  canvas.height = background.height = PLAN.length * scale;
  canvas.style.setProperty('--map-width', `${canvas.width}px`);
  const walls = background.getContext('2d');
  walls.fillStyle = '#65809c';
  for (let z = 0; z < PLAN.length; z++) for (let x = 0; x < PLAN[0].length; x++) {
    if (PLAN[z][x] === '#') walls.fillRect(x * scale, z * scale, scale, scale);
  }
  return {
    setVisible(visible) { canvas.hidden = !visible; },
    draw(camera) {
      if (canvas.hidden) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(background, 0, 0);
      const [gx, gz] = grid(camera.position.x, camera.position.z);
      const x = (gx + .5) / PLAN_SCALE * scale, z = (gz + .5) / PLAN_SCALE * scale;
      camera.getWorldDirection(direction);
      context.fillStyle = '#e5f3ff'; context.beginPath(); context.arc(x, z, 2, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#e5f3ff'; context.beginPath(); context.moveTo(x, z);
      context.lineTo(x + direction.x * 8, z + direction.z * 8); context.stroke();
    },
  };
}
