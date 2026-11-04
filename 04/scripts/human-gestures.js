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
export function createHumanPlan(duration = 60, seed = 20261104) {
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

export function sampleHumanGesture(plan, time) {
  const path = plan.path;
  let index = 1;
  while (index < path.length - 1 && time > path[index].t) index++;
  const from = path[index - 1],
    to = path[index];
  let u = Math.max(0, Math.min(1, (time - from.t) / (to.t - from.t)));
  u = to.ease === 'throw' ? Math.pow(u, 1.45) : smooth(u);
  return from.p.map((value, i) => value + (to.p[i] - value) * u);
}
