// Microphone test (every platform), like a voice app's mic test: while it
// runs, the controller's mic level shows live; with a headset plugged into
// the controller the mic is also heard live on the controller's output
// (loopback); without one there is no live sound (the speaker sits
// centimetres from the mic and would feed back), and "Listen back" plays the
// last few seconds instead, peak-normalized to the speaker test tune's level.
//
// Listen back plays only after the mic is closed and the recording is in
// hand: capture and playback never overlap (the earlier test played its
// clip on a 3 s timer the moment recording ended, with no visible end, so
// it spoke into the ear of someone still talking).
//
// Only the input named like the controller (controllerAudio.ts) is opened,
// with the browser's echo cancellation, noise suppression and gain control
// off so the raw mic is what's tested. The last LISTEN_SECONDS live in a ring
// on the audio thread (micRing.worklet.js), in memory only: nothing is
// written to disk. Everything stops with stop() (the button, the panel
// closing, the window hiding).
import { closeQuietly, controllerAudio } from "../controllerAudio";
import { PEAK } from "./speakerTune";
import { logged } from "../../errorText";

export const LISTEN_SECONDS = 3;
export const MIC_QUIET = 0.02; // a clip peaking below this is "almost silent"
// Listen back's gain: the clip's peak is brought to the speaker test tune's
// PEAK (one level for both tests), at most ×16 (+24 dB), and an almost
// silent clip at most ×4 (+12 dB), so noise isn't amplified into a roar.
export const MAX_GAIN = 16;
export const QUIET_GAIN = 4;
const PLAYBACK_GRACE_MS = 2000; // the clip must end this soon after its length
const DUMP_TIMEOUT_MS = 1000;

const RING_URL = new URL("./micRing.worklet.js", import.meta.url).href;

export type MicProblem = "no-mic" | "no-speaker" | "failed" | "lost" | "playback";

export interface MicClip {
  samples: Float32Array;
  sampleRate: number;
}

export interface MicSession {
  level(): number; // 0..1, the loudest sample of the latest frame
  setLoopback(on: boolean): void; // the mic live on the controller's output
  // Closes the mic, then hands over the last LISTEN_SECONDS (null if none).
  stop(): Promise<MicClip | null>;
}

export interface ListenResult {
  // error: SHOWN — desktop.audioTest.problem.failed (\`problem\` picks the desktop.audioTest.problem.<problem> line)
  ok: boolean;
  quiet: boolean; // peaking below MIC_QUIET
  peak: number; // 0..1, the recording's own peak
  gain: number; // the gain applied for playback
  // error: SHOWN — desktop.audioTest.problem.failed (each problem has its line)
  problem?: MicProblem;
}

type SinkContext = AudioContext & { setSinkId(id: string): Promise<void> };

// The gain that brings a clip peaking at `peak` to PEAK, capped; never above
// PEAK / peak, so the result can't clip.
export function playbackGain(peak: number): number {
  if (!(peak > 0)) return 1;
  return Math.min(peak < MIC_QUIET ? QUIET_GAIN : MAX_GAIN, PEAK / peak);
}

// Scales the clip's channels in place; returns its peak before and the gain.
export function normalizeClip(channels: Float32Array[]): { peak: number; gain: number } {
  const peak = Math.min(1, Math.max(0, ...channels.map(peakOf)));
  const gain = playbackGain(peak);
  // loop: NOT-WORTH — once per recorded clip, N = clip samples (a few seconds)
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, ch[i] * gain));
  return { peak, gain };
}

function peakOf(samples: Float32Array): number {
  let max = 0;
  // loop: HOT-PATH-OK — N = 1024 samples (fftSize) per meter frame while testing
  for (const v of samples) max = Math.max(max, Math.abs(v));
  return max;
}

// Opens the controller's mic (and its output, for the loopback). `onLost`
// runs if the mic goes away while testing (controller off or unplugged).
// error: SHOWN — desktop.audioTest.problem.no-mic (a \`problem\` result is said on the Mic test's status line)
export async function startMicTest(onLost: () => void): Promise<{ session: MicSession } | { problem: MicProblem }> {
  const [mic, speaker] = await Promise.all([controllerAudio("audioinput"), controllerAudio("audiooutput")]);
  if (!mic) return { problem: "no-mic" };
  if (!speaker) return { problem: "no-speaker" };
  const ctx = new AudioContext({ latencyHint: "interactive" }) as SinkContext;
  let stream: MediaStream | null = null;
  try {
    try {
      await ctx.setSinkId(speaker);
    } catch {
      // error: SHOWN — desktop.audioTest.problem.no-speaker
      closeQuietly(ctx);
      return { problem: "no-speaker" };
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: mic }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    await ctx.audioWorklet.addModule(RING_URL);
  } catch {
    // error: SHOWN — desktop.audioTest.problem.failed
    stream?.getTracks().forEach((t) => t.stop());
    closeQuietly(ctx);
    return { problem: "failed" };
  }
  const input = stream;
  const source = ctx.createMediaStreamSource(input);
  // Neither the analyser nor the ring has an output: nothing is heard but the loopback.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const ring = new AudioWorkletNode(ctx, "mic-ring", { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { seconds: LISTEN_SECONDS } });
  source.connect(analyser);
  source.connect(ring);
  const loop = ctx.createGain();
  loop.connect(ctx.destination);
  let looping = false;
  let stopped = false;
  const samples = new Float32Array(analyser.fftSize);
  input.getTracks().forEach((t) => t.addEventListener("ended", () => !stopped && onLost()));

  const dump = () =>
    new Promise<MicClip | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), DUMP_TIMEOUT_MS);
      ring.port.onmessage = (e: MessageEvent<MicClip>) => {
        clearTimeout(timer);
        resolve(e.data.samples.length ? e.data : null);
      };
      ring.port.postMessage("dump");
    });

  return {
    session: {
      level() {
        analyser.getFloatTimeDomainData(samples);
        return Math.min(1, peakOf(samples));
      },
      setLoopback(on) {
        if (stopped || on === looping) return;
        looping = on;
        if (on) source.connect(loop);
        else source.disconnect(loop);
      },
      async stop() {
        if (stopped) return null;
        stopped = true;
        // The mic closes first; the ring is read after, so nothing is still
        // being recorded once the clip is handed over.
        if (looping) source.disconnect(loop);
        input.getTracks().forEach((t) => t.stop());
        try {
          return await dump();
        } finally {
          closeQuietly(ctx);
        }
      },
    },
  };
}

// Plays a clip from stopped test on the controller's output, normalized.
// `onPlaying` gets its length once the sound starts. Stops when `signal`
// aborts (the result then says "failed" and is ignored by the caller).
export async function listenBack(clip: MicClip, signal: AbortSignal, onPlaying: (seconds: number) => void): Promise<ListenResult> {
  const samples = clip.samples.slice(); // the kept clip stays as recorded
  const { peak, gain } = normalizeClip([samples]);
  const result = (problem?: MicProblem): ListenResult => ({ ok: !problem, quiet: peak < MIC_QUIET, peak, gain, problem });
  const speaker = await controllerAudio("audiooutput");
  if (!speaker) return result("no-speaker");
  if (signal.aborted) return result("failed");
  const ctx = new AudioContext() as SinkContext;
  try {
    try {
      await ctx.setSinkId(speaker);
    } catch {
      // error: SHOWN — desktop.audioTest.problem.no-speaker
      return result("no-speaker");
    }
    const buffer = ctx.createBuffer(1, samples.length, clip.sampleRate);
    buffer.copyToChannel(samples, 0);
    await playClip(ctx, buffer, speaker, signal, () => onPlaying(buffer.duration));
    return result();
  } catch {
    // error: SHOWN — desktop.audioTest.problem.playback (or failed when stopped)
    return result(signal.aborted ? "failed" : "playback");
  } finally {
    closeQuietly(ctx);
  }
}

// Plays the buffer to the end; rejects if it can't start, the controller's
// output goes away, or it doesn't end in time (so a silent failure is never
// reported as played). Stops at once when `signal` aborts.
function playClip(ctx: AudioContext, buffer: AudioBuffer, speaker: string, signal: AbortSignal, onStart: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    let settled = false;
    const end = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      signal.removeEventListener("abort", abort);
      navigator.mediaDevices?.removeEventListener?.("devicechange", gone);
      if (!error) return resolve();
      try {
        src.stop();
      } catch {
        // error: NOT-WORTH — never started
      }
      reject(error);
    };
    const abort = () => end(new Error("aborted"));
    const gone = () =>
      void controllerAudio("audiooutput")
        .then((now) => {
          if (now !== speaker) end(new Error("output gone"));
        })
        .catch(logged("checking the controller's output after a device change (the watchdog still ends playback)"));
    const watchdog = setTimeout(() => end(new Error("playback didn't end")), buffer.duration * 1000 + PLAYBACK_GRACE_MS);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort);
    navigator.mediaDevices?.addEventListener?.("devicechange", gone);
    src.onended = () => end();
    try {
      src.start();
      onStart();
    } catch {
      // error: SHOWN — desktop.audioTest.problem.playback (rejects playClip)
      end(new Error("couldn't start"));
    }
  });
}
