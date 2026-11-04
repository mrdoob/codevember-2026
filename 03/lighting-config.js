// Shared by the studio lights and GPU thickness integration. Directions point
// from the wax toward each directional light, in world space.
export const WAX_LIGHTS = [
  { position: [-3.5, 6, 4.5], target: [0, 1, 0], color: '#fff2e6', intensity: 2.2 },
  { position: [-2, 3, -4], target: [0, 1.3, 0], color: '#fff0da', intensity: 1.8 }
];
export const WAX_LIGHT_DIRECTIONS = WAX_LIGHTS.map(({ position, target }) => {
  const d = position.map((v, i) => v - target[i]);
  const length = Math.hypot(...d);
  return d.map(v => v / length);
});
