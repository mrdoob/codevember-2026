import { LINK, linkPoint } from "./link-shape.js";

// Each tuft grows from its own piece of metal. A cut link hands its roots to
// the matching fragment without resetting the strands' momentum.
export function createAlgaeRoots(simulation, random) {
  const roots = [];
  for (let tuft = 0; tuft < 21; tuft++) {
    const azimuth = random() * Math.PI * 2;
    const latitude = -0.03 - random() * 1.1;
    for (let i = 0; i < 4; i++) {
      const a = azimuth + (random() - 0.5) * 0.09;
      const lat = latitude + (random() - 0.5) * 0.08;
      roots.push({
        root: [
          Math.sin(a) * Math.cos(lat) * 1.3,
          Math.sin(lat) * 1.3,
          Math.cos(a) * Math.cos(lat) * 1.3,
        ],
        length: 0.18 + random() * 0.48,
        width: 0.004 + random() * 0.006,
        phase: azimuth + random() * 0.5,
      });
    }
  }
  simulation.links.forEach((link, index) => {
    // Side rails leave the crowns, where neighboring links bear, unobstructed.
    const side = random() < 0.5 ? 0.39 : 0.89;
    const count = index < 8 ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const t = side + (random() - 0.5) * 0.09;
      const root = linkPoint(t);
      const a = (random() - 0.5) * 1.8;
      root[0] += Math.sign(root[0]) * Math.cos(a) * (LINK.tube + 0.004);
      root[2] += Math.sin(a) * (LINK.tube + 0.004);
      roots.push({
        root,
        linkIndex: index,
        linkT: t,
        collision: "link",
        resolveBody: () =>
          simulation.links[index] ??
          simulation.fractures
            .find((f) => f.index === index)
            ?.fragments.find((f) => (((t - f.start) % 1) + 1) % 1 <= f.span),
        length: 0.14 + random() * (index < 8 ? 0.4 : 0.25),
        width: 0.0035 + random() * 0.0045,
        phase: index * 1.3 + random() * 0.4,
      });
    }
  });
  return roots;
}
