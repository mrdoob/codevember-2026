import { createScore } from '../score.js';
import { createOrchestra } from '../orchestra.js';

// Render the same synthesis graph without playing through the user's speakers.
export async function checkMusic() {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const rate = 24000, duration = 90, tail = 47;
  const context = new OfflineAudioContext(2, rate * (duration + tail), rate);
  const orchestra = createOrchestra(context), score = createScore();
  orchestra.output.gain.value = 1;
  const events = score.takeUntil(duration);
  for (const event of events) orchestra.schedule(event, event.time);
  const buffer = await context.startRendering();
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  let peak = 0, energy = 0, dc = 0, stereo = 0, maxStep = 0;
  const windows = [];
  for (let start = 0; start < duration * rate; start += rate * 3) {
    let e = 0;
    for (let i = start; i < start + rate * 3; i++) {
      assert(Number.isFinite(left[i]) && Number.isFinite(right[i]), 'The score produced a non-finite sample');
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      const power = (left[i] ** 2 + right[i] ** 2) / 2;
      e += power; energy += power; dc += left[i] + right[i]; stereo += (left[i] - right[i]) ** 2;
      if (i) maxStep = Math.max(maxStep, Math.abs(left[i] - left[i - 1]), Math.abs(right[i] - right[i - 1]));
    }
    windows.push(Math.sqrt(e / (rate * 3)));
  }
  const rms = Math.sqrt(energy / (duration * rate)); dc /= duration * rate * 2;
  let tailPeak = 0;
  for (let i = left.length - rate; i < left.length; i++) tailPeak = Math.max(tailPeak, Math.abs(left[i]), Math.abs(right[i]));
  assert(peak < .9 && peak > .03, `Unexpected output peak: ${peak}`);
  assert(rms > .004 && rms < .2, `Unexpected average level: ${rms}`);
  assert(Math.abs(dc) < .001, `DC offset: ${dc}`);
  assert(stereo / (energy * 2) > .03, 'Stereo motion was lost');
  assert(Math.max(...windows) / Math.min(...windows.slice(1)) > 1.8, 'The score has no quiet/loud contrast');
  assert(tailPeak < .00001, `Notes or reverb continue after their release: ${tailPeak}`);
  // Allow queued ended callbacks to release graph references.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(orchestra.activeSources === 0, 'Completed voices were retained');
  orchestra.dispose();
  return { passed: true, renderedSeconds: duration + tail, events: events.length, peak, rms, dc, maxStep, tailPeak, windows };
}
