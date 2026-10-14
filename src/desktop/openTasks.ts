// The app's open tasks (notices.ts): what's waiting for the player, on which
// rail item, and the dismissal key of its notice. Also what's known about
// each dismissable notice now, so dismissals whose reason no longer applies
// are pruned. Pure, so the rules are tested without the app.
import type { TFunction } from "i18next";
import type { UpdateState } from "./api";
import type { FirmwareUpdateState } from "./useUpdates";
import { BOARD_PROBLEM_ID, type BoardProblem } from "./dongle/core1Status";
import { noticeKey, type NoticeTask, type Settled } from "./notices";
import { formatMb } from "./format";

export const APP_UPDATE_ID = "app-update";
export const FIRMWARE_UPDATE_ID = "firmware-update";
export const GAMES_SETUP_ID = "games-setup";

// The app update notice's key: the offered version, or (once it's installed
// and waits for a restart) "ready:" plus it, a new step that shows again.
export function appUpdateKey(app: UpdateState): string | null {
  if (app.phase === "available" || app.phase === "manual") return noticeKey(APP_UPDATE_ID, app.version);
  if (app.phase === "ready") return noticeKey(APP_UPDATE_ID, `ready:${app.version}`);
  return null;
}

export const firmwareUpdateKey = (version: string) => noticeKey(FIRMWARE_UPDATE_ID, version);
export const boardProblemKey = (p: BoardProblem) => noticeKey(BOARD_PROBLEM_ID, p.reason);

export interface TaskInput {
  app: UpdateState;
  fw: { available: boolean; latest: { version: string } | null; state: FirmwareUpdateState };
  connected: boolean;
  board: BoardProblem[] | null; // null: not known
  gamesCount: number;
}

export function openTasks(t: TFunction, input: TaskInput): { tasks: NoticeTask[]; settled: Settled } {
  const tasks: NoticeTask[] = [];
  const settled = new Map<string, string[]>();
  const { app, fw } = input;

  const appKey = appUpdateKey(app);
  if (appKey) {
    const text =
      app.phase === "available"
        ? t("desktop.update.appAvailable", { version: app.version, size: formatMb(app.size) })
        : app.phase === "manual"
          ? t("desktop.update.manual", { version: app.version })
          : app.phase === "ready"
            ? t("desktop.update.ready", { version: app.version })
            : "";
    tasks.push({ id: APP_UPDATE_ID, place: "app", text, key: appKey });
    settled.set(APP_UPDATE_ID, [appKey]);
  } else if (app.phase === "up-to-date") settled.set(APP_UPDATE_ID, []);
  // Checking, downloading, installing or failed: not known yet, keep the key.

  const writing = fw.state.phase === "running" || fw.state.phase === "verifying";
  if (fw.available && fw.latest && !writing) {
    const key = firmwareUpdateKey(fw.latest.version);
    tasks.push({ id: FIRMWARE_UPDATE_ID, place: "dongle", text: t("desktop.update.fwAvailable", { version: fw.latest.version }), key });
    settled.set(FIRMWARE_UPDATE_ID, [key]);
  } else if (input.connected && fw.latest && !fw.available && fw.state.phase === "idle") settled.set(FIRMWARE_UPDATE_ID, []);

  if (input.board) {
    const keys: string[] = [];
    // loop: NOT-WORTH — N ≤ 3 board problems; when the 10 s health read changes
    for (const p of input.board) {
      const key = boardProblemKey(p);
      keys.push(key);
      tasks.push({ id: BOARD_PROBLEM_ID, place: "dongle", text: p.text, key });
    }
    settled.set(BOARD_PROBLEM_ID, keys);
  }

  // No notice of its own: the Games page's setup is the place (the count it always had).
  if (input.gamesCount > 0) tasks.push({ id: GAMES_SETUP_ID, place: "games", text: t("desktop.games.attention", { count: input.gamesCount }), count: input.gamesCount });

  return { tasks, settled };
}
