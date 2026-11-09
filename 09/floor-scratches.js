import { CanvasTexture, RepeatWrapping } from "three/webgpu";

// Seeded, seamless wear: a few dragged scuffs amongst many fine scratches.
// Generated once, with mipmaps to keep thin marks stable at grazing angles.
export function createFloorScratches(size = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, size, size);
  context.lineCap = "round";
  let seed = 901;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 200; i++) {
    const x = random() * size,
      y = random() * size,
      angle = random() * Math.PI * 2;
    const length = (0.004 + random() ** 2 * 0.1) * size;
    const bend = (random() - 0.5) * length * 0.16,
      brightness = 75 + random() * 160;
    const lines = random() < 0.22 ? 2 + Math.floor(random() * 4) : 1;
    const width = ((0.55 + random() * 0.7) * size) / 1024;
    for (let line = 0; line < lines; line++) {
      const offset = (line * (1 + random() * 2) * size) / 1024;
      const end = length * (0.65 + random() * 0.35);
      const alpha = 0.45 + random() * 0.55;
      context.strokeStyle = `rgba(${brightness},${brightness},${brightness},${alpha})`;
      context.lineWidth = width;
      // Wrap strokes across tile boundaries, including their curved ends.
      for (const dx of [-size, 0, size])
        for (const dy of [-size, 0, size]) {
          context.save();
          context.translate(x + dx, y + dy);
          context.rotate(angle);
          context.beginPath();
          context.moveTo(-end * 0.5, offset);
          context.quadraticCurveTo(0, offset + bend, end * 0.5, offset);
          context.stroke();
          context.restore();
        }
    }
  }
  const map = new CanvasTexture(canvas);
  map.name = "Random floor scratches";
  map.wrapS = map.wrapT = RepeatWrapping;
  map.anisotropy = 8;
  return map;
}
