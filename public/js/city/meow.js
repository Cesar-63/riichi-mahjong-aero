// A meow made on the spot with Web Audio, no sound files: a buzzing voice
// whose pitch rises and falls ("mi-au") through a filter that slides from
// a bright "i" to a dark "u". Each one comes out a little different.

let ctx = null;

// Browsers only let sound start after the player did something on the
// page; call this from a key press or a click to have it ready.
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx ||= new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function meow({ volume = 0.22, pitch = 1 } = {}) {
  const ac = unlockAudio();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  const len = 0.65 + Math.random() * 0.25;
  const f0 = (470 + Math.random() * 140) * pitch;

  const voice = ac.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(f0 * 0.85, t);
  voice.frequency.linearRampToValueAtTime(f0 * 1.3, t + len * 0.28);
  voice.frequency.linearRampToValueAtTime(f0 * 1.15, t + len * 0.55);
  voice.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + len);
  // a slight wobble in the throat
  const wobble = ac.createOscillator();
  wobble.frequency.value = 7 + Math.random() * 3;
  const depth = ac.createGain();
  depth.gain.value = f0 * 0.025;
  wobble.connect(depth).connect(voice.frequency);

  // the mouth: one formant that closes from "i" to "a" to "u", and a
  // softer, darker body under it
  const mouth = ac.createBiquadFilter();
  mouth.type = 'bandpass';
  mouth.Q.value = 5;
  mouth.frequency.setValueAtTime(2700, t);
  mouth.frequency.linearRampToValueAtTime(1500, t + len * 0.4);
  mouth.frequency.exponentialRampToValueAtTime(700, t + len);
  const throat = ac.createBiquadFilter();
  throat.type = 'lowpass';
  throat.frequency.value = 1100;
  const mix = ac.createGain();
  mix.gain.value = 0.35;

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(volume, t + 0.06);
  env.gain.setValueAtTime(volume, t + len * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0001, t + len);

  voice.connect(mouth).connect(env);
  voice.connect(throat).connect(mix).connect(env);
  env.connect(ac.destination);
  voice.start(t);
  wobble.start(t);
  voice.stop(t + len + 0.05);
  wobble.stop(t + len + 0.05);
}
