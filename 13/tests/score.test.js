import test from 'node:test';
import assert from 'node:assert/strict';
import { createScore } from '../score.js';

test('the score is independent of scheduling cadence, with no repeated or missing events', () => {
  const once = createScore().takeUntil(240), score = createScore(), incremental = [];
  for (let time = 0; time <= 240; time += .25) incremental.push(...score.takeUntil(time));
  assert.deepEqual(incremental, once);
  assert.deepEqual(score.takeUntil(240), []);
  assert.notDeepEqual(createScore(2).takeUntil(240), once);
});

test('an hour of evolving music keeps its event queue and polyphony bounded', () => {
  const score = createScore(), kinds = new Set(); let active = [], previous = -1, maximum = 0;
  for (let time = 0; time <= 3600; time += .5) {
    const events = score.takeUntil(time);
    for (const event of events) {
      kinds.add(event.kind);
      assert.ok(event.time >= previous); previous = event.time;
      assert.ok(event.duration > 0 && event.duration < 45);
      assert.ok(event.frequency > 28 && event.frequency < 5000);
      assert.ok(event.gain > 0 && event.gain < .2);
      assert.ok(Math.abs(event.pan) <= .9);
      for (const value of Object.values(event)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
    }
    active = active.filter(event => event.time + event.duration > time).concat(events);
    maximum = Math.max(maximum, active.length);
    assert.ok(score.pending < 40, 'Future score events grow without bound');
  }
  assert.equal(kinds.size, 7);
  assert.ok(maximum <= 20, `Too many simultaneous gestures: ${maximum}`);
});
