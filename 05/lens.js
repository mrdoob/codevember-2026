// A smooth zero-slope onset followed by a long tail. The transition distance
// gives half the maximum blur, rather than an abrupt fully blurred plane.
export function defocusAmount(distance, transition) {
  const squared = distance.div(transition).pow(2);
  return squared.div(squared.add(1));
}
