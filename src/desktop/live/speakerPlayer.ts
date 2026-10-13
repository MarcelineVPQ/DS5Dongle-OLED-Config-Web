// The speaker test's player: one for the whole app, so the tune keeps playing
// while the owner browses other pages. It plays Korobeiniki (speakerTune.ts)
// on the controller's speaker (never the PC's), rendered on the spot and
// routed to the DualSense output. It stops only on stop() (the Stop button or
// a second press of Play), at the tune's end, when the controller's speaker
// output goes away (controller or dongle unplugged), or with the app.
// SpeakerTest subscribes to show its countdown and progress line.
import { useSyncExternalStore } from "react";
import { controllerSpeaker } from "../narrator";
import { renderTune, tuneSeconds } from "./speakerTune";

export interface SpeakerPlayback {
  playing: boolean;
  startedAt: number; // Date.now() when the sound started; 0 while starting
  duration: number; // seconds
  noSpeaker: boolean; // the last try found no controller speaker (or couldn't route to it)
}

let state: SpeakerPlayback = { playing: false, startedAt: 0, duration: tuneSeconds(), noSpeaker: false };
const listeners = new Set<() => void>();
let stopNow: (() => void) | null = null;
let running: Promise<void> | null = null;

function set(patch: Partial<SpeakerPlayback>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function speakerPlayback(): SpeakerPlayback {
  return state;
}

export function subscribeSpeaker(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSpeakerPlayback(): SpeakerPlayback {
  return useSyncExternalStore(subscribeSpeaker, speakerPlayback);
}

export function stopSpeakerTest(): void {
  stopNow?.();
}

// Starts the tune (or returns the running one); resolves when it ends.
export function startSpeakerTest(): Promise<void> {
  running ??= playTune().finally(() => {
    running = null;
  });
  return running;
}

async function playTune(): Promise<void> {
  let cancelled = false;
  stopNow = () => {
    cancelled = true;
  };
  set({ playing: true, startedAt: 0, noSpeaker: false });
  const sink = await controllerSpeaker();
  if (!sink || cancelled) {
    stopNow = null;
    return set({ playing: false, noSpeaker: !sink });
  }
  const ctx = new AudioContext();
  let noSpeaker = false;
  const gone = () =>
    void controllerSpeaker().then((now) => {
      if (now !== sink) stopNow?.();
    });
  navigator.mediaDevices?.addEventListener?.("devicechange", gone);
  try {
    await (ctx as AudioContext & { setSinkId(id: string): Promise<void> }).setSinkId(sink);
    const pcm = renderTune(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
    buffer.copyToChannel(pcm, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    await new Promise<void>((done) => {
      src.onended = () => done();
      stopNow = () => {
        // a 20 ms fade so stopping mid-note doesn't click
        const fade = ctx.createGain();
        src.disconnect();
        src.connect(fade).connect(ctx.destination);
        fade.gain.setValueAtTime(1, ctx.currentTime);
        fade.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02);
        src.stop(ctx.currentTime + 0.025);
      };
      if (cancelled) done();
      else {
        src.start();
        set({ startedAt: Date.now() });
      }
    });
  } catch {
    noSpeaker = true; // couldn't route to the controller: stay silent
  } finally {
    navigator.mediaDevices?.removeEventListener?.("devicechange", gone);
    stopNow = null;
    set({ playing: false, startedAt: 0, noSpeaker });
    void ctx.close();
  }
}
