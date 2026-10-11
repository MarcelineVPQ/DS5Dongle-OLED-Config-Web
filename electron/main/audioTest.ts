// Microphone test (Linux): record a few seconds from the DualSense's own mic
// and play them back on the DualSense's own speaker, with a live level. The
// page never gets microphone access (the session still denies "media"): the
// main process records with PipeWire's tools, only from the device whose
// name is the controller's, keeps the clip in memory and drops it after
// playback. Nothing is written to disk.
import { execFile, spawn, type ChildProcess } from "node:child_process";

const DUALSENSE = /DualSense|Wireless_Controller/i;
const RATE = 48000;
const SECONDS = 3;

export interface MicTestResult {
  ok: boolean;
  peak: number; // 0..1 over the whole clip
  problem?: "no-mic" | "no-speaker" | "failed";
}

function list(kind: "sinks" | "sources"): Promise<string[]> {
  return new Promise((resolve) =>
    execFile("pactl", ["list", "short", kind], { timeout: 3000 }, (err, out) =>
      resolve(
        err
          ? []
          : out
              .split("\n")
              .map((l) => l.split("\t")[1])
              .filter(Boolean),
      ),
    ),
  );
}

export async function dualSenseDevices(): Promise<{ mic: string | null; speaker: string | null }> {
  const [sources, sinks] = await Promise.all([list("sources"), list("sinks")]);
  return {
    mic: sources.find((s) => DUALSENSE.test(s) && !s.endsWith(".monitor")) ?? null,
    speaker: sinks.find((s) => DUALSENSE.test(s)) ?? null,
  };
}

let busy = false;

// Stops a child: SIGTERM, then SIGKILL if it hasn't closed a second later.
function stop(child: ChildProcess) {
  child.kill("SIGTERM");
  const kill = setTimeout(() => child.kill("SIGKILL"), 1000);
  child.once("close", () => clearTimeout(kill));
}

// Records SECONDS from the controller mic (reporting the level ~10x a
// second), then plays it back on the controller speaker. One test at a time;
// every step is bounded, so a stuck PipeWire tool can't block later tests.
export async function micTest(onLevel: (level: number) => void): Promise<MicTestResult> {
  if (busy) return { ok: false, peak: 0, problem: "failed" };
  busy = true;
  try {
    return await run(onLevel);
  } finally {
    busy = false;
  }
}

async function run(onLevel: (level: number) => void): Promise<MicTestResult> {
  const { mic, speaker } = await dualSenseDevices();
  if (!mic) return { ok: false, peak: 0, problem: "no-mic" };
  if (!speaker) return { ok: false, peak: 0, problem: "no-speaker" };

  const chunks: Buffer[] = [];
  let peak = 0;
  const recorded = await new Promise<boolean>((resolve) => {
    const rec = spawn("pw-record", ["--target", mic, "--rate", String(RATE), "--channels", "1", "--format", "f32", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    let pending = Buffer.alloc(0);
    rec.stdout.on("data", (data: Buffer) => {
      chunks.push(data);
      pending = Buffer.concat([pending, data]);
      // ~100 ms windows: report the loudest sample.
      const windowBytes = (RATE / 10) * 4;
      while (pending.length >= windowBytes) {
        let max = 0;
        for (let i = 0; i < windowBytes; i += 4) max = Math.max(max, Math.abs(pending.readFloatLE(i)));
        pending = pending.subarray(windowBytes);
        peak = Math.max(peak, max);
        onLevel(Math.min(1, max));
      }
    });
    const timer = setTimeout(() => stop(rec), SECONDS * 1000);
    rec.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    rec.on("close", () => {
      clearTimeout(timer);
      resolve(chunks.length > 0);
    });
  });
  if (!recorded) return { ok: false, peak: 0, problem: "failed" };
  onLevel(0);

  // Play it back on the controller speaker (bounded: clip length + 3 s).
  const played = await new Promise<boolean>((resolve) => {
    const play = spawn("pw-cat", ["--playback", "--target", speaker, "--rate", String(RATE), "--channels", "1", "--format", "f32", "-"], { stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => stop(play), (SECONDS + 3) * 1000);
    // pw-cat may exit before taking the whole clip (EPIPE): the close handler reports it.
    play.stdin.on("error", () => undefined);
    play.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    play.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    play.stdin.end(Buffer.concat(chunks));
  });
  chunks.length = 0;
  return { ok: played, peak, problem: played ? undefined : "failed" };
}
