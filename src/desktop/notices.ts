// Notices that can be dismissed, and the open tasks behind the rail's dots.
//
// A task notice (an update to install, a problem the board reports) is
// dismissed by its key: its id plus the REASON it shows, e.g.
// "firmware-update:v0.9.5-dev.12". It stays hidden across restarts until the
// reason changes (a new key shows again). Only those keys are kept (no
// times, no history), and a key whose reason no longer applies is pruned.
// Info and success notices just close; an error from a user action closes
// and shows again when the action fails again (the caller clears its error).
//
// The rail's dots follow the task, not the dismissal: a dot stays until the
// task is done, whether its notice was dismissed or not.
import { createContext, useCallback, useContext, useMemo } from "react";
import { readPref, writePref } from "./storage";
import { externalStore } from "./externalStore";
import type { RailItem } from "./AppRail";

export const DISMISSED_KEY = "ds5.dismissedNotices";
// A bound on what's kept (pruning keeps it far below this).
export const MAX_DISMISSED = 50;

export const noticeKey = (id: string, reason: string): string => `${id}:${reason}`;
export const noticeIdOf = (key: string): string => {
  const at = key.indexOf(":");
  return at < 0 ? key : key.slice(0, at);
};

export function parseDismissed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    // loop: NOT-WORTH — N ≤ MAX_DISMISSED keys; on a dismissal or a prune
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string").slice(-MAX_DISMISSED) : [];
  } catch {
    // error: NOT-WORTH — a broken list reads as none dismissed: the notices just show again
    return [];
  }
}

// The stored list as written (local storage, kept in step on every write):
// every notice and the App settings list see a dismissal at once.
// cache: OK — key=DISMISSED_KEY; invalidated=every dismissal, Show again and prune writes it; bound=MAX_DISMISSED keys
const stored = externalStore<string | null>(readPref(DISMISSED_KEY));
const writeDismissed = (keys: string[]) => {
  const raw = JSON.stringify(keys.slice(-MAX_DISMISSED));
  writePref(DISMISSED_KEY, raw);
  stored.set(raw);
};

export function dismissNotice(key: string): void {
  const keys = parseDismissed(readPref(DISMISSED_KEY));
  if (!keys.includes(key)) writeDismissed([...keys, key]);
}

export function restoreNotices(which: readonly string[] | "all"): void {
  const keys = parseDismissed(readPref(DISMISSED_KEY));
  // loop: NOT-WORTH — N ≤ MAX_DISMISSED keys; on Show again
  writeDismissed(which === "all" ? [] : keys.filter((k) => !which.includes(k)));
}

// What applies now, for each notice id whose state is known: the keys that
// are current (empty = the task is done). Ids not listed are unknown yet (an
// update check that hasn't answered, no board connected) and keep their keys.
export type Settled = ReadonlyMap<string, readonly string[]>;

export function pruneDismissed(keys: readonly string[], settled: Settled): string[] {
  // loop: NOT-WORTH — N ≤ MAX_DISMISSED keys; when what applies changes
  return keys.filter((k) => {
    const current = settled.get(noticeIdOf(k));
    return current === undefined || current.includes(k);
  });
}

// Drops the keys whose reason no longer applies (written only when one goes).
export function pruneStored(settled: Settled): void {
  const keys = parseDismissed(readPref(DISMISSED_KEY));
  const kept = pruneDismissed(keys, settled);
  if (kept.length !== keys.length) writeDismissed(kept);
}

// The dismissed keys, live.
export function useDismissedNotices(): ReadonlySet<string> {
  const raw = stored.use();
  return useMemo(() => new Set(parseDismissed(raw)), [raw]);
}

export function useNoticeDismissed(key: string | undefined): [boolean, () => void] {
  const dismissed = useDismissedNotices();
  const dismiss = useCallback(() => key && dismissNotice(key), [key]);
  return [key !== undefined && dismissed.has(key), dismiss];
}

// An open task: what's waiting, on which rail item, and (when it has a
// notice that can be dismissed) that notice's key.
export interface NoticeTask {
  id: string;
  place: RailItem;
  text: string; // the dot's tooltip and the Dismissed notices row
  key?: string; // set when a notice for it can be dismissed
  count?: number; // a number on the dot (Games: changes waiting); otherwise a plain dot
  section?: string; // the section on its page that holds it (accordion/sections.ts): rail dots and Go to open it
}

export interface Reminder {
  count: number | null; // null: a plain dot
  tip: string;
}

// The rail's dots: one per rail item with open tasks, its tooltip listing them.
export function railReminders(tasks: readonly NoticeTask[]): Partial<Record<RailItem, Reminder>> {
  const out: Partial<Record<RailItem, Reminder>> = {};
  // loop: NOT-WORTH — N ≤ ~6 open tasks; when the tasks change
  for (const task of tasks) {
    const had = out[task.place];
    const count = task.count ?? null;
    out[task.place] = had ? { count: had.count === null || count === null ? null : had.count + count, tip: `${had.tip}\n${task.text}` } : { count, tip: task.text };
  }
  return out;
}

// The app's open tasks and how to get to each one's place (DesktopApp
// provides it; App settings → Dismissed notices reads it).
export const NoticeTasksContext = createContext<{ tasks: readonly NoticeTask[]; goTo: (place: RailItem, section?: string) => void }>({ tasks: [], goTo: () => undefined });
export const useNoticeTasks = () => useContext(NoticeTasksContext);
