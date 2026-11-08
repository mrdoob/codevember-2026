export const FLOOR_Y = -3;
export const CEILING_Y = 6.4;
// Conservative vertical depth of the beams, ducts, and suspended rails below the deck.
export const CEILING_FIXTURE_DEPTH = 1.15;
export const ROOM_HALF_WIDTH = 9.5;
export const ROOM_BACK_Z = -8.6;

export const CAMERA_MAX_DISTANCE = 24;
export const CAMERA_MIN_Y = FLOOR_Y + 0.18;
export const CAMERA_MAX_Y = CEILING_Y - CEILING_FIXTURE_DEPTH - 0.18;
// Broad slabs hide their edges beyond the viewing range. Repeated service
// bays cover the complete camera orbit without duplicating their geometry.
export const ENVIRONMENT_HALF_SIZE = CAMERA_MAX_DISTANCE * 8;
export const CEILING_BAY_WIDTH = ROOM_HALF_WIDTH * 2;
export const CEILING_BAY_DEPTH = 24.8;
const baysX = Math.ceil((CAMERA_MAX_DISTANCE + 1) / CEILING_BAY_WIDTH - 0.5);
const baysZ = Math.ceil(
  (CAMERA_MAX_DISTANCE + 1 + Math.abs(ROOM_BACK_Z + CEILING_BAY_DEPTH / 2)) /
    CEILING_BAY_DEPTH -
    0.5,
);
export const CEILING_BAY_OFFSETS = [];
for (let x = -baysX; x <= baysX; x++)
  for (let z = -baysZ; z <= baysZ; z++) {
    CEILING_BAY_OFFSETS.push([x * CEILING_BAY_WIDTH, 0, z * CEILING_BAY_DEPTH]);
  }

// Columns sit outside the complete unscaled projection envelope.
export const COLUMN_LOCATIONS = [
  [-8.15, 1.5],
  [8.15, 1.5],
  [-6.8, -6.2],
  [6.8, -6.2],
];
export const COLUMN_BASE_WIDTH = 1.05;
export const COLUMN_SHAFT_WIDTH = 0.65;
