// Departure chimes. Japanese stations play a short melody as a train leaves; Animetro plays its own
// (an original tune, synthesised with Web Audio, no audio files) when you log an episode or finish a show.
const KEY = 'animetro.sound';
export const soundOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export const setSound = on => { try { on ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, '0'); } catch {} };

// Semitones above A4 (440 Hz), with start time and length in beats.
const TUNES = {
  // logged an episode: a quick two-note "doors closing" ding
  tick: { bpm: 360, notes: [[7, 0, 1], [14, 1, 2]] },
  // finished a show: a little rising, bell-like departure melody that resolves upward
  done: { bpm: 300, notes: [[3, 0, 1], [7, 1, 1], [10, 2, 1], [15, 3, 1.5], [14, 4.5, .5], [10, 5, 1], [12, 6, 1], [15, 7, 1], [19, 8, 4]] },
};

let ctx;
export function chime(name = 'tick') {
  if (!soundOn()) return;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.();
    const { bpm, notes } = TUNES[name] || TUNES.tick, beat = 60 / bpm, t0 = ctx.currentTime + .03;
    const master = ctx.createGain();
    master.gain.value = .16;
    master.connect(ctx.destination);
    for (const [semi, at, len] of notes) {
      const f = 440 * 2 ** (semi / 12), start = t0 + at * beat, end = start + len * beat + .6;
      // a bell: the note plus a quieter overtone, both fading out
      for (const [mult, vol] of [[1, 1], [2.76, .25]]) {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f * mult;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(vol, start + .01);
        g.gain.exponentialRampToValueAtTime(.0001, end);
        osc.connect(g).connect(master);
        osc.start(start);
        osc.stop(end);
      }
    }
  } catch {} // no audio support: stay quiet
}
