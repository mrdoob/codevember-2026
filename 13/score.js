import { randomSeed } from './random.js';

// Original, seeded orchestral gestures. Time is measured in seconds, not beats:
// overlapping clouds gather, break into scattered attacks, and fall quiet again.
export function createScore(seed = 131980) {
  const random = randomSeed(seed), pick = values => values[Math.floor(random() * values.length)];
  let phrase = 0, nextPhrase = 0, pending = [];
  function compose() {
    const start = nextPhrase, duration = 26 + random() * 12;
    const energy = [.34, .72, .45, .92, .18, .56, .83][phrase++ % 7] * (.85 + random() * .15);
    const root = pick([46.25, 51.91, 58.27, 65.41]);
    const add = (kind, offset, length, gain, extra = {}) => pending.push({
      kind, time: start + offset, duration: length, gain, pan: (random() - .5) * 1.35,
      seed: Math.floor(random() * 0x7fffffff), ...extra,
    });
    add('bass', 0, duration + 3, .075, { frequency: root, glide: -.35 - random() * .65 });
    add('air', .1, duration + 2, .038, { frequency: 500 + random() * 900 });
    const clouds = 2 + Math.floor(energy * 3);
    for (let i = 0; i < clouds; i++) {
      const high = i % 2 === 0, frequency = high ? 680 + random() * 820 : 170 + random() * 250;
      add('strings', .4 + i * duration / clouds + random() * 1.3, 7 + random() * 9,
        .028 + energy * .032, { frequency, glide: (random() - .42) * (2 + energy * 7), voices: 5 + Math.floor(energy * 4), energy });
    }
    add('brass', 5 + random() * 7, 5 + random() * 6, .07 + energy * .065,
      { frequency: root * pick([1, 1.41, 2.03]), glide: -1.7 + random() * 3, energy });
    if (energy > .4) add('brass', duration * .65, 5 + random() * 4, .055 + energy * .06,
      { frequency: root * 1.07, glide: -2.4, energy });
    const strikes = 2 + Math.floor(energy * 5);
    for (let i = 0; i < strikes; i++) {
      const offset = 3 + random() * (duration - 6);
      add(i % 3 === 0 ? 'metal' : 'knock', offset, i % 3 === 0 ? 7 + random() * 5 : .45 + random() * .8,
        .075 + random() * .065 * energy, { frequency: i % 3 === 0 ? 110 + random() * 180 : 170 + random() * 220 });
      if (energy > .6 && i % 2) add('knock', offset + .19 + random() * .37, .7, .075, { frequency: 240 + random() * 160 });
    }
    if (energy > .4) add('scrape', duration * .52 + random() * 3, 2 + random() * 3, .065 * energy,
      { frequency: 1800 + random() * 1800 });
    nextPhrase += duration;
    pending.sort((a, b) => a.time - b.time);
  }
  return {
    takeUntil(time) {
      while (nextPhrase <= time) compose();
      let count = 0; while (count < pending.length && pending[count].time <= time) count++;
      return pending.splice(0, count);
    },
    get pending() { return pending.length; },
  };
}
