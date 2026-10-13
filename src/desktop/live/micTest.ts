// Microphone test (every platform): record a few seconds from the
// controller's own mic with Chromium's audio capture and play them back on
// the controller's own speaker, with a live level while recording. Only the
// input named like the controller (controllerAudio.ts) is opened, with the
// browser's echo cancellation, noise suppression and gain control off so the
// raw mic is what's tested. The clip stays in memory and is dropped after
// playback; nothing is written to disk. The stream, the level loop and the
// audio context end with the test or as soon as `signal` aborts (the panel
// closes or the window hides).
import { controllerAudio } from "../controllerAudio";

export const MIC_SECONDS = 3;

export interface MicTestResult {
  ok: boolean;
  peak: number; // 0..1 over the whole clip
  problem?: "no-mic" | "no-speaker" | "failed";
}

export interface MicTestOptions {
  signal: AbortSignal;
  onLevel: (level: number) => void; // 0..1, once a frame while recording
  onPlayback: () => void; // recording done, playing it back
}

const failed: MicTestResult = { ok: false, peak: 0, problem: "failed" };

export async function runMicTest({ signal, onLevel, onPlayback }: MicTestOptions): Promise<MicTestResult> {
  const [mic, speaker] = await Promise.all([controllerAudio("audioinput"), controllerAudio("audiooutput")]);
  if (!mic) return { ok: false, peak: 0, problem: "no-mic" };
  if (!speaker) return { ok: false, peak: 0, problem: "no-speaker" };
  if (signal.aborted) return failed;

  const ctx = new AudioContext();
  let stream: MediaStream | null = null;
  let frame = 0;
  const release = () => {
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  try {
    try {
      await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(speaker);
    } catch {
      return { ok: false, peak: 0, problem: "no-speaker" };
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: mic }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    if (signal.aborted) return failed;

    // The live level: the loudest sample of each frame (display only).
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    frame = requestAnimationFrame(function tick() {
      analyser.getFloatTimeDomainData(samples);
      onLevel(Math.min(1, peakOf(samples)));
      frame = requestAnimationFrame(tick);
    });

    const blob = await record(stream, MIC_SECONDS * 1000, signal);
    release();
    onLevel(0);
    const clip = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (signal.aborted) return failed;
    let peak = 0;
    for (let c = 0; c < clip.numberOfChannels; c++) peak = Math.max(peak, peakOf(clip.getChannelData(c)));

    onPlayback();
    const src = ctx.createBufferSource();
    src.buffer = clip;
    src.connect(ctx.destination);
    await new Promise<void>((done) => {
      const stop = () => src.stop();
      src.onended = () => {
        signal.removeEventListener("abort", stop);
        done();
      };
      signal.addEventListener("abort", stop);
      src.start();
    });
    return signal.aborted ? failed : { ok: true, peak: Math.min(1, peak) };
  } catch {
    return failed;
  } finally {
    release();
    void ctx.close();
  }
}

function peakOf(samples: Float32Array): number {
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  return max;
}

// Records `ms` of the stream (or until `signal` aborts, which rejects).
function record(stream: MediaStream, ms: number, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const recorder = new MediaRecorder(stream);
    const parts: Blob[] = [];
    const stop = () => {
      if (recorder.state !== "inactive") recorder.stop();
    };
    const timer = setTimeout(stop, ms);
    signal.addEventListener("abort", stop);
    recorder.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data);
    };
    recorder.onstop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted || !parts.length) reject(new Error("no recording"));
      else resolve(new Blob(parts, { type: recorder.mimeType }));
    };
    recorder.onerror = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      reject(new Error("recorder failed"));
    };
    recorder.start();
  });
}
