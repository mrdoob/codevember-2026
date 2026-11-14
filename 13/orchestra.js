import { randomSeed } from './random.js';

// All sound sources and the stereo room impulse are synthesized locally.
// The graph works in both AudioContext and OfflineAudioContext.
export function createOrchestra(context, destination = context.destination) {
  const random = randomSeed(131313), permanent = [], gestures = new Set();
  let disposed = false;
  const node = n => (permanent.push(n), n);
  const bus = node(context.createGain()), dry = node(context.createGain()), wet = node(context.createGain());
  const room = node(context.createConvolver()), highpass = node(context.createBiquadFilter());
  const lowpass = node(context.createBiquadFilter()), compressor = node(context.createDynamicsCompressor());
  const limiter = node(context.createWaveShaper()), output = node(context.createGain());
  dry.gain.value = .82; wet.gain.value = .65;
  highpass.type = 'highpass'; highpass.frequency.value = 28; highpass.Q.value = .7;
  lowpass.type = 'lowpass'; lowpass.frequency.value = 7800; lowpass.Q.value = .5;
  compressor.threshold.value = -19; compressor.knee.value = 14; compressor.ratio.value = 5;
  compressor.attack.value = .008; compressor.release.value = .32;
  limiter.curve = Float32Array.from({ length: 2049 }, (_, i) => Math.tanh((i / 1024 - 1) * 1.5) * .88);
  limiter.oversample = '2x'; output.gain.value = 0;
  bus.connect(dry).connect(highpass); bus.connect(room).connect(wet).connect(highpass);
  highpass.connect(lowpass).connect(compressor).connect(limiter).connect(output).connect(destination);

  const impulse = context.createBuffer(2, Math.ceil(context.sampleRate * 3.8), context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel); let smoothed = 0;
    for (let i = 0; i < data.length; i++) {
      smoothed = smoothed * .55 + (random() * 2 - 1) * .45;
      const t = i / context.sampleRate;
      data[i] = t < .023 ? 0 : smoothed * Math.exp(-t * 1.65) * Math.min(1, (t - .023) * 30);
    }
    for (const [delay, amplitude] of [[.041, .42], [.079, .29], [.131, .18]]) data[Math.round((delay + channel * .007) * context.sampleRate)] += amplitude;
  }
  room.buffer = impulse;
  const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 2.3), context.sampleRate);
  const noiseData = noise.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = random() * 2 - 1;
  const wave = (power, phase) => {
    const real = new Float32Array(33), imaginary = new Float32Array(33);
    for (let i = 1; i < real.length; i++) {
      const amplitude = 1 / Math.pow(i, power), angle = Math.sin(i * 2.31 + phase) * .35;
      real[i] = Math.sin(angle) * amplitude; imaginary[i] = Math.cos(angle) * amplitude;
    }
    return context.createPeriodicWave(real, imaginary);
  };
  const strings = Array.from({ length: 4 }, (_, i) => wave(.95, i * 1.7));
  const brass = wave(.75, .4);

  function schedule(event, at = event.time) {
    if (disposed) return;
    const rng = randomSeed(event.seed), nodes = [], sources = [];
    const n = value => (nodes.push(value), value);
    const end = at + event.duration;
    const envelope = n(context.createGain()), pan = n(context.createStereoPanner());
    const filter = n(context.createBiquadFilter()); filter.type = 'lowpass'; filter.Q.value = .65;
    const p = Math.max(-.9, Math.min(.9, event.pan));
    pan.pan.setValueAtTime(p, at); pan.pan.linearRampToValueAtTime(p * -.65, end);
    envelope.connect(filter).connect(pan).connect(bus);
    const attack = { bass: 2.8, air: 3.5, strings: 2.2 + rng() * 2, brass: .8, metal: .012, knock: .006, scrape: .5 }[event.kind];
    const attackEnd = at + Math.min(event.duration * .3, attack);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(event.gain, attackEnd);
    if (event.kind === 'metal' || event.kind === 'knock') {
      envelope.gain.exponentialRampToValueAtTime(.00001, end - .025);
    } else {
      envelope.gain.linearRampToValueAtTime(event.gain * .65, at + event.duration * .66);
      envelope.gain.linearRampToValueAtTime(0, end);
    }
    envelope.gain.linearRampToValueAtTime(0, end);
    filter.frequency.value = { bass: 500, air: 1900, strings: 5200, brass: 2100, metal: 6500, knock: 3200, scrape: 6000 }[event.kind];
    const source = s => { n(s); sources.push(s); return s; };
    const gain = (value, target = envelope) => { const g = n(context.createGain()); g.gain.value = value; g.connect(target); return g; };
    function oscillator(frequency, type, target, glide = 0) {
      const o = source(context.createOscillator());
      if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
      o.frequency.setValueAtTime(frequency, at);
      if (glide) o.frequency.exponentialRampToValueAtTime(frequency * 2 ** (glide / 12), end);
      o.connect(target); o.start(at); o.stop(end + .02); return o;
    }
    function modulation(frequency, depth, parameter) {
      const amount = gain(depth, parameter); return oscillator(frequency, 'sine', amount);
    }
    function breath(frequency, q, amount) {
      const b = n(context.createBiquadFilter()); b.type = 'bandpass'; b.frequency.value = frequency; b.Q.value = q;
      const s = source(context.createBufferSource()); s.buffer = noise; s.loop = true;
      s.connect(b).connect(gain(amount)); s.start(at, rng() * 2); s.stop(end + .02); return b;
    }
    const f = event.frequency;
    if (event.kind === 'strings') {
      for (let i = 0; i < event.voices; i++) {
        const amplitude = gain(.58 / Math.sqrt(event.voices));
        const tremolo = gain(.72, amplitude);
        const detune = (i / (event.voices - 1) - .5) * (1.1 + event.energy * 1.7);
        const o = oscillator(f * 2 ** (detune / 12), strings[i % strings.length], tremolo, event.glide * (.7 + rng() * .6));
        modulation(4.5 + rng() * 2.2, 8 + rng() * 13, o.detune);
        modulation(7 + rng() * 5, .22, tremolo.gain);
      }
      breath(1800 + f * .6, .8, .28);
      filter.frequency.setValueAtTime(2200 + f, at);
      filter.frequency.linearRampToValueAtTime(3800 + f, at + event.duration * .6);
      filter.frequency.linearRampToValueAtTime(1600 + f, end);
    } else if (event.kind === 'brass') {
      for (const interval of [0, .31, 6.83]) {
        const o = oscillator(f * 2 ** (interval / 12), brass, gain(.3), event.glide);
        modulation(3.3 + rng() * 2, 9, o.detune);
      }
      breath(500, 1, .14);
      filter.frequency.setValueAtTime(300, at); filter.frequency.exponentialRampToValueAtTime(850 + event.energy * 1600, attackEnd + .4);
      filter.frequency.exponentialRampToValueAtTime(330, end);
    } else if (event.kind === 'bass') {
      for (const ratio of [1, 1.013, 1.497]) oscillator(f * ratio, 'triangle', gain(.28), event.glide);
    } else if (event.kind === 'air' || event.kind === 'scrape') {
      const b = breath(f, event.kind === 'air' ? .8 : 3.5, 1);
      b.frequency.setValueAtTime(f, at); b.frequency.exponentialRampToValueAtTime(f * (event.kind === 'air' ? 1.4 : .43), end);
      if (event.kind === 'scrape') modulation(13 + rng() * 14, f * .08, b.frequency);
    } else if (event.kind === 'metal') {
      for (const [i, ratio] of [1, 1.47, 2.09, 2.56, 3.93, 5.23].entries()) {
        const partial = gain(.38 / (1 + i * .6));
        partial.gain.setValueAtTime(partial.gain.value, at);
        partial.gain.exponentialRampToValueAtTime(.0001, at + event.duration / (1 + i * .24));
        oscillator(f * ratio, 'sine', partial, -.08);
      }
      breath(3200, 1, .07);
    } else if (event.kind === 'knock') {
      oscillator(f, 'sine', gain(.5), -5);
      oscillator(f * 1.63, 'sine', gain(.18), -2);
      breath(1100 + f, 1.7, .55);
    }
    const gesture = { nodes, sources }; gestures.add(gesture);
    let remaining = sources.length;
    const cleanup = () => { if (--remaining > 0) return; for (const item of nodes) item.disconnect(); gestures.delete(gesture); };
    for (const s of sources) s.onended = cleanup;
  }
  return {
    schedule, output,
    get activeGestures() { return gestures.size; },
    get activeSources() { return [...gestures].reduce((count, g) => count + g.sources.length, 0); },
    dispose() {
      disposed = true;
      for (const g of gestures) { for (const s of g.sources) { s.onended = null; try { s.stop(); } catch {} } for (const n of g.nodes) n.disconnect(); }
      gestures.clear(); for (const n of permanent) n.disconnect();
    },
  };
}
