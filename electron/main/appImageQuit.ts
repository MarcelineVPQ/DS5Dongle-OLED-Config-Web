// Linux AppImage: quitting without a crash on the way out.
//
// An AppImage runs from a FUSE mount (/tmp/.mount_DS5Don…) that its runtime
// serves while any process still holds the runtime's keepalive pipe: this
// process does, and so does every child that inherited it. Chromium's zygotes
// (and the GPU, utility and renderer processes) don't: they finish exiting a
// moment after this process. When the mount went first, a zygote touched
// code mapped from it and took a SIGBUS, a core dump and a desktop crash
// notice on a normal quit (0.9.5-dev.17, 2026-10-17). So as the app quits, a
// tiny helper that inherits the pipe waits for this process and every
// process below it to end (at most MAX_WAIT_MS), then exits; the runtime
// unmounts after the last of them. Windows and macOS have no such mount.
import { readdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const MAX_WAIT_MS = 5000;
const STEP_MS = 50;
const MAX_PIDS = 256;

/** Every process below `root` (children, their children…), from a lookup of
 * each process's direct children; at most MAX_PIDS. */
export function descendantPids(root: number, childrenOf: (pid: number) => number[]): number[] {
  const out: number[] = [];
  const seen = new Set([root]);
  const queue = [root];
  // loop: NOT-WORTH — once at quit; the app's process tree, about 10 processes (capped at MAX_PIDS)
  while (queue.length && out.length < MAX_PIDS) {
    // loop: NOT-WORTH — the direct children of one process, a few
    for (const pid of childrenOf(queue.shift()!)) {
      if (seen.has(pid) || out.length >= MAX_PIDS) continue;
      seen.add(pid);
      out.push(pid);
      queue.push(pid);
    }
  }
  return out;
}

// The helper's script: a fixed string; the pids come as arguments ("$@"),
// never pasted in. It ends once none of them is left, or after MAX_WAIT_MS
// by the clock (5–6 s: whole seconds), however slow a busy PC runs it.
export const WAIT_SCRIPT = `end=$(($(date +%s) + ${MAX_WAIT_MS / 1000})); while [ "$(date +%s)" -lt "$end" ]; do a=; for p in "$@"; do kill -0 "$p" 2>/dev/null && a=1; done; [ -z "$a" ] && exit 0; sleep ${STEP_MS / 1000}; done`;

/** /bin/sh's argv for the helper that waits for `pids`. */
export const mountGuardArgs = (pids: number[]): string[] => ["-c", WAIT_SCRIPT, "sh", ...pids.map(String)];

/** A process's direct children (every thread's, from /proc). */
function procChildren(pid: number): number[] {
  try {
    // loop: NOT-WORTH — once at quit, per process of the app's tree: its threads (a few dozen) and their children (a few)
    return readdirSync(`/proc/${pid}/task`).flatMap((tid) => readFileSync(`/proc/${pid}/task/${tid}/children`, "utf8").split(" ").filter(Boolean).map(Number));
  } catch {
    // error: NOT-WORTH — the process ended meanwhile (or /proc isn't readable): it has no children to wait for
    return [];
  }
}

/** Linux AppImage: keep the mount up until this process and all of its
 * processes have exited (above). Called once, from will-quit. */
export function holdAppImageMountUntilExit(): void {
  if (process.platform !== "linux" || !process.env.APPIMAGE) return;
  const pids = [process.pid, ...descendantPids(process.pid, procChildren)];
  // lifetime: OK — detached and unref'd: it outlives this process on purpose and ends by itself once these processes are gone (MAX_WAIT_MS at most)
  // error: NOT-WORTH — without it the quit is as before (a zygote may still crash on the way out); nothing for the user to do
  spawn("/bin/sh", mountGuardArgs(pids), { detached: true, stdio: "ignore", env: { PATH: "/usr/bin:/bin" } }).unref();
}
