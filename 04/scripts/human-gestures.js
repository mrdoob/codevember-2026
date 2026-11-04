const FPS = 30;
const smooth = x => x * x * (3 - 2 * x);

function randomSource(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Plan once, so pauses and hand paths are independent of encoding speed.
// Uneven strokes, brief hesitations, and releases during motion avoid a metronome.
export function createHumanPlan(duration = 60, seed = 20261104, interactionCount = null) {
  if (interactionCount !== null) return createCountedPlan(duration, seed, interactionCount);
  const random = randomSource(seed),
    range = (a, b) => a + (b - a) * random();
  const round = t => Math.round(t * FPS) / FPS;
  const plans = [],
    kinds = ['toss', 'shake', 'tug', 'toss', 'shake', 'toss', 'shake', 'tug', 'toss', 'shake'];
  let at = round(range(3.1, 4.1)),
    previousStrand = -1;
  while (at < duration - 4) {
    const kind = kinds[plans.length % kinds.length];
    const region = plans.length === 0 ? 'falling' : random() < 0.36 ? 'falling' : 'floor';
    let strand = Math.floor(random() * 5);
    if (strand === previousStrand) strand = (strand + 1 + Math.floor(random() * 4)) % 5;
    previousStrand = strand;
    const direction = random() < 0.5 ? -1 : 1;
    const lift = region === 'floor' ? range(1.1, 1.85) : range(0.1, 0.5);
    const path = [{ t: 0, p: [0, 0, 0] }];
    const add = (seconds, p, ease = 'smooth') => path.push({ t: round(path.at(-1).t + seconds), p, ease });
    const amplitude = range(0.65, 1.15),
      depth = range(-0.4, 0.5);
    // Small grip adjustment before a larger action, as a hand takes hold.
    add(range(0.1, 0.2), [range(-0.08, 0.08), range(0.04, 0.12), range(-0.05, 0.05)]);
    if (kind === 'toss') {
      add(range(0.18, 0.3), [-direction * range(0.15, 0.3), lift * 0.25, -depth * 0.3]);
      // Accelerate through the release; do not ease to a stop at the endpoint.
      add(range(0.34, 0.52), [direction * range(1.05, 1.6), lift, depth], 'throw');
    } else if (kind === 'tug') {
      add(range(0.32, 0.5), [direction * amplitude * 0.55, lift * 0.65, depth * 0.4]);
      add(range(0.12, 0.3), [direction * amplitude * 0.5, lift * 0.6, depth * 0.5]);
      add(range(0.3, 0.55), [-direction * amplitude * 0.25, lift * 0.35, depth], 'smooth');
    } else {
      add(range(0.3, 0.5), [-direction * amplitude * 0.25, lift * 0.75, depth * 0.25]);
      const strokes = 4 + Math.floor(random() * 4);
      for (let stroke = 0; stroke < strokes; stroke++) {
        const sign = stroke % 2 ? -direction : direction;
        const extent = amplitude * range(0.5, 1.12);
        const height = lift + range(-0.2, 0.3);
        add(range(0.24, 0.56), [sign * extent + direction * stroke * 0.035, height, range(-0.4, 0.45)]);
        // An occasional hesitation breaks the repeated back-and-forth rhythm.
        if (stroke > 0 && stroke < strokes - 1 && random() < 0.23) {
          add(range(0.12, 0.26), [sign * extent * 0.96, height + range(-0.05, 0.08), path.at(-1).p[2]]);
        }
      }
      if (random() < 0.6)
        add(range(0.25, 0.4), [direction * amplitude * 1.2, lift + range(-0.15, 0.25), depth], 'throw');
    }
    const length = path.at(-1).t;
    if (at + length > duration - 2.8) break;
    plans.push({
      at,
      kind,
      region,
      strand,
      direction,
      duration: length,
      path,
      focusX: range(0.34, 0.66),
      pickHeight: region === 'falling' ? range(1.7, 2.5) : range(0.08, 0.4),
      centerPull: region === 'floor' ? range(0.18, 0.45) : 0
    });
    // Some quick follow-ups, some longer moments to watch the yarn land.
    const pause = random() < 0.3 ? range(0.55, 1.35) : range(2.1, 4.9);
    at = round(at + length + pause);
  }
  return plans;
}

// A busier session still needs room for reactions. Keep gestures at hand speed
// and distribute the remaining time into short follow-ups and longer rests.
function createCountedPlan(duration, seed, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Interaction count must be a positive integer');
  const random = randomSource(seed),
    range = (a, b) => a + (b - a) * random();
  const round = t => Math.round(t * FPS) / FPS;
  const kinds = Array.from(
    { length: count },
    (_, i) => ['flick', 'toss', 'tug', 'shake', 'flick', 'lift', 'toss', 'shake', 'tug', 'flick'][i % 10]
  );
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  kinds[0] = 'tug';
  if (count > 1) kinds[count - 1] = 'toss';
  const plans = kinds.map((kind, index) => {
    const region = index === 0 ? 'falling' : index === count - 1 ? 'floor' : random() < 0.4 ? 'falling' : 'floor';
    const direction = random() < 0.5 ? -1 : 1;
    const small = kind === 'flick' || kind === 'tug';
    const lift = region === 'floor' ? range(small ? 0.4 : 1.05, small ? 0.9 : 1.8) : range(0.08, 0.42);
    const reach = range(small ? 0.4 : 0.7, small ? 0.8 : 1.25),
      depth = range(-0.35, 0.4);
    const path = [{ t: 0, p: [0, 0, 0] }];
    const add = (seconds, p) => path.push({ t: round(path.at(-1).t + seconds), p });
    // Take hold, then commit. The little adjustment varies independently of the pull.
    add(range(0.08, 0.16), [range(-0.06, 0.06), range(0.03, 0.09), range(-0.04, 0.04)]);
    if (kind === 'flick') {
      add(range(0.08, 0.13), [-direction * 0.1, lift * 0.18, -depth * 0.15]);
      add(range(0.22, 0.34), [direction * reach, lift, depth]);
    } else if (kind === 'toss') {
      add(range(0.17, 0.26), [-direction * reach * 0.23, lift * 0.24, -depth * 0.3]);
      add(range(0.16, 0.23), [direction * reach * 0.12, lift * 0.54, depth * 0.12]);
      add(range(0.23, 0.34), [direction * reach * 1.15, lift, depth]);
    } else if (kind === 'tug') {
      // Overshoot slightly, correct, and either let go or make a tiny second pull.
      add(range(0.23, 0.36), [direction * reach, lift, depth]);
      add(range(0.13, 0.22), [direction * reach * 0.8, lift * 0.86, depth + 0.06]);
      add(range(0.14, 0.24), [direction * reach * range(0.65, 0.9), lift * 0.7, depth * 0.8]);
    } else if (kind === 'lift') {
      add(range(0.33, 0.48), [direction * reach * 0.3, lift, depth * 0.4]);
      add(range(0.18, 0.3), [direction * reach * 0.34, lift + 0.02, depth * 0.4]);
      add(range(0.35, 0.5), [direction * reach, lift * 0.7, depth]);
      add(range(0.14, 0.22), [direction * reach * 0.9, lift * 0.45, depth * 0.9]);
    } else {
      add(range(0.22, 0.35), [-direction * reach * 0.2, lift * 0.8, depth * 0.2]);
      const strokes = 3 + Math.floor(random() * 3);
      for (let stroke = 0; stroke < strokes; stroke++) {
        const side = stroke % 2 ? -direction : direction;
        add(range(0.22, 0.4), [side * reach * range(0.5, 1), lift + range(-0.18, 0.2), range(-0.3, 0.4)]);
        if (stroke === 1 && random() < 0.3) {
          const p = path.at(-1).p;
          add(range(0.1, 0.18), [p[0] * 0.98, p[1] + 0.02, p[2]]);
        }
      }
    }
    // Component-wise monotone tangents round the path without wild spline
    // overshoots. A hand can keep rising while its lateral swing reverses.
    for (let i = 0; i < path.length; i++) {
      path[i].v = [0, 0, 0];
      if (i === 0) continue;
      const before = path[i - 1],
        current = path[i],
        after = path[i + 1];
      const dt = current.t - before.t;
      for (let axis = 0; axis < 3; axis++) {
        const incoming = (current.p[axis] - before.p[axis]) / dt;
        if (!after) {
          path[i].v[axis] = incoming * (kind === 'toss' || kind === 'flick' ? 1.4 : 0.15);
          continue;
        }
        const nextDt = after.t - current.t;
        const outgoing = (after.p[axis] - current.p[axis]) / nextDt;
        if (incoming * outgoing <= 0) continue;
        const a = 2 * nextDt + dt,
          b = nextDt + 2 * dt;
        path[i].v[axis] = (a + b) / (a / incoming + b / outgoing);
      }
    }
    return {
      kind,
      region,
      direction,
      duration: path.at(-1).t,
      path,
      strand: Math.floor(random() * 5),
      focusX: range(0.3, 0.7),
      pickHeight: region === 'falling' ? range(1.7, 2.5) : range(0.08, 0.4),
      centerPull: region === 'floor' ? range(-0.05, 0.25) : 0
    };
  });
  const start = Math.round(range(2.4, 3) * FPS),
    ending = Math.round(2.8 * FPS);
  const activeFrames = plans.reduce((sum, plan) => sum + Math.round(plan.duration * FPS), 0);
  const gapCount = count - 1,
    minimumGap = 6;
  const extra = Math.round(duration * FPS) - start - ending - activeFrames - gapCount * minimumGap;
  if (extra < 0) throw new Error('Too many gestures for this video duration');
  const weights = Array.from({ length: gapCount }, () => (random() < 0.38 ? range(0.12, 0.3) : range(0.7, 1.8)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(weight => (extra * weight) / totalWeight);
  const gaps = exact.map(value => minimumGap + Math.floor(value));
  const remainder = extra - exact.reduce((sum, value) => sum + Math.floor(value), 0);
  const order = exact.map((value, i) => ({ i, fraction: value % 1 })).sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder && i < order.length; i++) gaps[order[i].i]++;
  let frame = start;
  plans.forEach((plan, i) => {
    plan.at = frame / FPS;
    plan.followPrevious = i > 0 && (gaps[i - 1] < 0.7 * FPS || random() < 0.15);
    frame += Math.round(plan.duration * FPS) + (gaps[i] ?? 0);
  });
  return plans;
}

export function sampleHumanGesture(plan, time) {
  const path = plan.path;
  let index = 1;
  while (index < path.length - 1 && time > path[index].t) index++;
  const from = path[index - 1],
    to = path[index];
  let u = Math.max(0, Math.min(1, (time - from.t) / (to.t - from.t)));
  if (from.v && to.v) {
    const dt = to.t - from.t,
      u2 = u * u,
      u3 = u2 * u;
    return from.p.map(
      (value, i) =>
        (2 * u3 - 3 * u2 + 1) * value +
        (u3 - 2 * u2 + u) * dt * from.v[i] +
        (-2 * u3 + 3 * u2) * to.p[i] +
        (u3 - u2) * dt * to.v[i]
    );
  }
  u = to.ease === 'throw' ? Math.pow(u, 1.45) : smooth(u);
  return from.p.map((value, i) => value + (to.p[i] - value) * u);
}
