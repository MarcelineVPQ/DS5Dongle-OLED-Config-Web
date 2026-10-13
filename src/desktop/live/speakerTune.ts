// The speaker test tune: Korobeiniki, the 19th-century Russian folk song
// (public domain), in our own plain chiptune arrangement: the melody alone,
// parts A, B, A, played twice (one buffer, so the join can't click; part A
// ends on a rest, so the repeat lands on the beat). Rendered here to PCM so it is the same on every
// platform and testable; SpeakerTest plays the buffer on the controller.

// [note, beats]; null is a rest. One beat is a quarter note.
type Step = readonly [string | null, number];

const PART_A: Step[] = [
  ["E5", 1],
  ["B4", 0.5],
  ["C5", 0.5],
  ["D5", 1],
  ["C5", 0.5],
  ["B4", 0.5],
  ["A4", 1],
  ["A4", 0.5],
  ["C5", 0.5],
  ["E5", 1],
  ["D5", 0.5],
  ["C5", 0.5],
  ["B4", 1.5],
  ["C5", 0.5],
  ["D5", 1],
  ["E5", 1],
  ["C5", 1],
  ["A4", 1],
  ["A4", 1],
  [null, 1],
  [null, 0.5],
  ["D5", 1],
  ["F5", 0.5],
  ["A5", 1],
  ["G5", 0.5],
  ["F5", 0.5],
  ["E5", 1.5],
  ["C5", 0.5],
  ["E5", 1],
  ["D5", 0.5],
  ["C5", 0.5],
  ["B4", 1],
  ["B4", 0.5],
  ["C5", 0.5],
  ["D5", 1],
  ["E5", 1],
  ["C5", 1],
  ["A4", 1],
  ["A4", 1],
  [null, 1],
];

const PART_B: Step[] = [
  ["E5", 2],
  ["C5", 2],
  ["D5", 2],
  ["B4", 2],
  ["C5", 2],
  ["A4", 2],
  ["G#4", 2],
  ["B4", 2],
  ["E5", 2],
  ["C5", 2],
  ["D5", 2],
  ["B4", 2],
  ["C5", 1],
  ["E5", 1],
  ["A5", 2],
  ["G#5", 4],
];

const ONCE: Step[] = [...PART_A, ...PART_B, ...PART_A];
export const TUNE: readonly Step[] = [...ONCE, ...ONCE];

export const BEAT_S = 0.4; // 150 beats a minute
export const PEAK = 0.8; // the dev.6 test sound's level
const ATTACK_S = 0.005;
const RELEASE_S = 0.02;
const GAP = 0.12; // share of each note left silent, so repeated notes are distinct
const FADE_S = 0.03; // whole-tune fade in/out
const TAIL_S = 0.1;

const SEMITONE: Record<string, number> = { C: -9, "C#": -8, D: -7, "D#": -6, E: -5, F: -4, "F#": -3, G: -2, "G#": -1, A: 0, "A#": 1, B: 2 };

export function noteHz(note: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(note);
  if (!m) throw new Error(`bad note ${note}`);
  return 440 * 2 ** ((SEMITONE[m[1]] + (Number(m[2]) - 4) * 12) / 12);
}

export const noteCount = (tune: readonly Step[] = TUNE) => tune.filter(([n]) => n !== null).length;
export const tuneSeconds = (tune: readonly Step[] = TUNE) => tune.reduce((s, [, b]) => s + b * BEAT_S, 0) + TAIL_S;

// Mono samples in -PEAK..PEAK: a 25% pulse (bright, NES-like, DC removed),
// short attack, a light decay, a release before the gap: no clicks.
export function renderTune(sampleRate: number, tune: readonly Step[] = TUNE): Float32Array<ArrayBuffer> {
  const total = Math.round(tuneSeconds(tune) * sampleRate);
  const out = new Float32Array(total);
  const duty = 0.25;
  let t0 = 0;
  for (const [note, beats] of tune) {
    const len = beats * BEAT_S;
    if (note !== null) {
      const hz = noteHz(note);
      const on = len * (1 - GAP);
      const start = Math.round(t0 * sampleRate);
      const n = Math.round(on * sampleRate);
      for (let i = 0; i < n && start + i < total; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, t / ATTACK_S, (on - t) / RELEASE_S) * (0.7 + 0.3 * Math.exp(-t / 0.15));
        const phase = (t * hz) % 1;
        // Pulse high = 1 - duty, low = -duty (zero mean), scaled so the high peak is 1.
        const wave = ((phase < duty ? 1 : 0) - duty) / (1 - duty);
        out[start + i] = PEAK * Math.max(0, env) * wave;
      }
    }
    t0 += len;
  }
  const fade = Math.round(FADE_S * sampleRate);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[total - 1 - i] *= i / fade;
  }
  return out;
}
