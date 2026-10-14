// The narrator: short voice lines for app events and the guided tour.
//
// Rules (agreed with the user, 2026-10-10):
// - She speaks only through the controller's speaker, never the PC's: the
//   line goes to the audio output named like the DualSense, and without one
//   she stays silent.
// - Silent until the user says yes ("ask"): the tour's first step asks, with
//   the question itself as the sample; App settings can change it any time.
// - Only while the window is on screen, so an app that autostarts in the tray
//   never speaks unprompted.
// - One line at a time; a newer tour line cuts the previous one off.
// - Captions (on by default): her words show while she speaks, for anyone
//   who can't hear her; with the voice turned off, the short confirmations
//   still show as text. Nothing shows while the narrator is still "ask".
//
// Audio: src/assets/voice/<lang>/<key>.ogg, words: captions.json
// (tools/build_voice_assets.py).
import { useSyncExternalStore } from "react";
import i18n from "../i18n";
import type { DesktopSettings } from "./api";
import captionTexts from "../assets/voice/captions.json";
import { NARRATOR_LANGS, NARRATOR_OFF } from "../protocol/bridgeClient";
import { isWindowShown } from "./useWindowShown";
import { controllerAudio } from "./controllerAudio";

export type NarratorSetting = DesktopSettings["narratorVoice"];

const files = import.meta.glob("../assets/voice/*/*.ogg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const URLS = new Map<string, string>(
  Object.entries(files).map(([path, url]) => {
    const [lang, file] = path.split("/").slice(-2);
    return [`${lang}/${file.replace(/\.ogg$/, "")}`, url];
  }),
);
const LANGS = [...new Set([...URLS.keys()].map((k) => k.split("/")[0]))];

let setting: NarratorSetting = "ask";
let captionsOn = true;
let caption: { key: string; text: string } | null = null;
const listeners = new Set<() => void>();
// loop: NOT-WORTH — N ≤ 3 listeners; on narrator state change, not per frame
const notify = () => listeners.forEach((l) => l());
void window.desktop?.getSettings().then((s) => {
  setting = s.narratorVoice ?? "ask";
  captionsOn = s.narratorCaptions ?? true;
  notify();
});

export function setNarrator(next: Exclude<NarratorSetting, "ask">): void {
  setting = next;
  notify();
  void window.desktop?.setSetting("narratorVoice", next);
}

export function setCaptions(next: boolean): void {
  captionsOn = next;
  notify();
  void window.desktop?.setSetting("narratorCaptions", next);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useNarrator = (): NarratorSetting => useSyncExternalStore(subscribe, () => setting);
export const useCaptionsOn = (): boolean => useSyncExternalStore(subscribe, () => captionsOn);
export const useCaption = (): { key: string; text: string } | null => useSyncExternalStore(subscribe, () => caption);

function captionFor(key: string): string | null {
  const texts = (captionTexts as Record<string, Record<string, string>>)[key];
  return texts ? (texts[voiceLang()] ?? texts.en ?? null) : null;
}

function showCaption(key: string): void {
  const text = captionFor(key);
  caption = text ? { key, text } : null;
  notify();
}

function hideCaption(key: string): void {
  if (caption?.key !== key) return;
  caption = null;
  notify();
}

// On screen: the page is visible and the window isn't hidden in the tray.
const onScreen = isWindowShown;

function voiceLang(): string {
  const want = i18n.resolvedLanguage ?? i18n.language ?? "en";
  // loop: NOT-WORTH — N ≤ 12 voice languages; once per line spoken
  return LANGS.find((l) => l === want) ?? LANGS.find((l) => l.split("-")[0] === want.split("-")[0]) ?? "en";
}

// The DualSense speaker's output device id, or null (never the PC's speakers).
export function controllerSpeaker(): Promise<string | null> {
  return controllerAudio("audiooutput");
}

// What the dongle's own narrator should be set to (protocol 1.3): her
// language while she's on, otherwise off (still "ask" = off).
export function firmwareNarratorValue(value: NarratorSetting): number {
  if (value !== "on") return NARRATOR_OFF;
  const lang = voiceLang();
  const i = NARRATOR_LANGS.findIndex((l) => l === lang);
  return 1 + Math.max(0, i);
}

export function hasLine(key: string): boolean {
  return URLS.has(`en/${key}`);
}

let current: HTMLAudioElement | null = null;
let chain: Promise<void> = Promise.resolve();

export function stopNarrator(): void {
  if (current) {
    current.pause();
    current = null;
  }
  caption = null;
  notify();
}

// lifetime: OK — fires once (caption linger)
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Long enough to read: about 60 ms a character, at least 2 s.
const readingTime = (text: string) => Math.max(2000, text.length * 60);

// Voice through the controller (when it's there) with the caption, or the
// caption alone. The caption lingers a moment after she stops.
async function play(key: string, voice: boolean, withCaption: boolean): Promise<void> {
  const url = URLS.get(`${voiceLang()}/${key}`) ?? URLS.get(`en/${key}`);
  const sink = voice && url ? await controllerSpeaker() : null; // no controller speaker: never the PC's
  if (withCaption) showCaption(key);
  let spoke = false;
  if (sink && url) {
    // lifetime: OK — one element per line, dropped when it ends, errors or stop() pauses it
    const audio = new Audio(url);
    try {
      await audio.setSinkId(sink);
      current = audio;
      spoke = true;
      await new Promise<void>((resolve) => {
        // lifetime: OK — handlers live on the element and go with it when the line ends
        audio.onended = audio.onerror = audio.onpause = () => resolve();
        audio.play().catch(() => resolve());
      });
    } catch {
      // couldn't route to the controller: stay silent
    }
    if (current === audio) current = null;
  }
  if (withCaption) {
    await wait(spoke ? 700 : readingTime(captionFor(key) ?? ""));
    hideCaption(key);
  }
}

// Resolves once she has finished everything queued (at once if she's quiet).
export function narratorIdle(): Promise<void> {
  return chain;
}

// Say a line if the narrator is on (or `ask` is allowed, for the tour's
// question). `cut` stops whatever is playing first (tour steps).
export function say(key: string, opts: { allowAsk?: boolean; cut?: boolean } = {}): Promise<void> {
  const voice = setting === "on" || (opts.allowAsk === true && setting === "ask");
  // Captions follow the voice; with the voice turned off they still show the
  // words (captions-only). Never while the narrator hasn't been answered.
  const withCaption = captionsOn && (voice || setting === "off");
  if ((!voice && !withCaption) || !onScreen() || !hasLine(key)) return Promise.resolve();
  if (opts.cut) {
    stopNarrator();
    chain = Promise.resolve();
  }
  chain = chain.then(() => play(key, voice, withCaption));
  return chain;
}
