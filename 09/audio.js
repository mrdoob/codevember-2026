// An ideal contact pickup: PCM comes directly from simulated surface velocity.
// No independent oscillator, harmonics, or tap sound is mixed into this signal.
export function createAudio() {
  let context,
    master,
    enabled = false,
    disposed = false,
    playing = false,
    volume = 0.55,
    speed = 1,
    nextTime = 0;
  const sources = new Set();
  function clear() {
    for (const source of sources) {
      source.stop();
      source.disconnect();
    }
    sources.clear();
    nextTime = 0;
  }
  async function enable(value) {
    if (disposed) return false;
    if (!value) {
      enabled = false;
      clear();
      if (context) master.gain.setTargetAtTime(0, context.currentTime, 0.015);
      return false;
    }
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext)
        throw new Error("Audio is not available in this browser.");
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0;
      const highpass = context.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 20;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 8;
      master.connect(highpass).connect(compressor).connect(context.destination);
    }
    await context.resume();
    enabled = true;
    nextTime = 0;
    return true;
  }
  return {
    enable,
    get enabled() {
      return enabled;
    },
    get state() {
      return context?.state ?? "uninitialized";
    },
    get queued() {
      return sources.size;
    },
    update(isPlaying, newVolume, newSpeed) {
      if ((playing && !isPlaying) || speed !== newSpeed) clear();
      playing = isPlaying;
      volume = newVolume;
      speed = newSpeed;
      if (context)
        master.gain.setTargetAtTime(
          enabled && playing ? volume * 0.7 : 0,
          context.currentTime,
          0.02,
        );
    },
    enqueue(samples, sampleRate) {
      if (!enabled || !playing || !context || disposed || samples.length === 0)
        return;
      const now = context.currentTime;
      // A short queue absorbs RAF jitter; stale sound is discarded on pause.
      if (nextTime < now + 0.008 || nextTime > now + 0.3) {
        clear();
        nextTime = now + 0.09;
      }
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = speed;
      source.connect(master);
      source.start(nextTime);
      nextTime += samples.length / sampleRate / speed;
      sources.add(source);
      source.onended = () => {
        source.disconnect();
        sources.delete(source);
      };
    },
    dispose() {
      disposed = true;
      enabled = false;
      clear();
      context?.close();
    },
  };
}
