import { LINK } from "./link-shape.js";

// One source for the visible forged eye and its capsule collision surface.
export const MINE_EYE = Object.freeze({
  bend: 0.18,
  halfStraight: 0.11,
  tube: 0.075,
});
export const EYE_CENTER = [0, -1.58, 0];
export const FIRST_LINK_DROP =
  -EYE_CENTER[1] +
  MINE_EYE.bend +
  MINE_EYE.halfStraight +
  LINK.bend +
  LINK.halfStraight -
  MINE_EYE.tube -
  LINK.tube -
  0.006;
