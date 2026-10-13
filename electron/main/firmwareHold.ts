// While the renderer writes firmware to the board, nothing may end this
// process: a restart or quit mid-write leaves the board half-written (it only
// recovers through BOOTSEL). The one place that holds restart, quit and the
// self-updater's install until the write is over; they run right after it.
import type { FirmwareHoldState } from "../../src/desktop/api";

export type HeldAction = "install" | "restart" | "quit";
// Install before restart (a restart starts what was installed), quit last.
const ORDER: HeldAction[] = ["install", "restart", "quit"];

export class FirmwareHold {
  private writing = false;
  private held = new Map<HeldAction, () => void>();

  constructor(private readonly emit: (state: FirmwareHoldState) => void) {}

  get active(): boolean {
    return this.writing;
  }

  state(): FirmwareHoldState {
    return { writing: this.writing, restartQueued: this.held.has("restart"), quitQueued: this.held.has("quit") };
  }

  setWriting(writing: boolean): void {
    if (writing === this.writing) return;
    this.writing = writing;
    const due = writing ? [] : ORDER.flatMap((kind) => this.held.get(kind) ?? []);
    if (!writing) this.held.clear();
    this.emit(this.state());
    for (const run of due) run();
  }

  // Runs `run` now when nothing is being written (true), else holds it until
  // the write ends (false). Asking twice for the same action holds it once.
  whenDone(kind: HeldAction, run: () => void): boolean {
    if (!this.writing) {
      run();
      return true;
    }
    this.held.set(kind, run);
    this.emit(this.state());
    return false;
  }

  // before-quit and closing the window: true lets the quit go ahead; while
  // writing it cancels the event and quits (via `quit`) once the write ends.
  allowQuit(event: { preventDefault(): void }, quit: () => void): boolean {
    if (!this.writing) return true;
    event.preventDefault();
    this.whenDone("quit", quit);
    return false;
  }
}
