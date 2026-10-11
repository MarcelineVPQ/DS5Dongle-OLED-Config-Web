// First-run guided tour: the screen dims, a spotlight glides from one part of
// the app to the next, and a card explains it. The hands-on steps wait for the
// real controller (press a button, pull a trigger) or the mouse (open a
// panel) and tick off when done. Shown once, the first time a controller is
// connected; replayable from App settings. Respects reduced motion (the CSS
// drops the glide and the pulse).
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { InputReport } from "../../oled/inputReport";
import type { PanelView } from "../live/PartPanel";

const DONE_KEY = "ds5.tourDone";
const PAD = 10;

export function tourDone(): boolean {
  try {
    return window.localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    window.localStorage.setItem(DONE_KEY, "1");
  } catch {
    // storage blocked: the tour may show again next time
  }
}

// App settings' "Show the tour again" asks for it through this event.
export const TOUR_EVENT = "ds5:start-tour";
export const startTour = () => window.dispatchEvent(new Event(TOUR_EVENT));

const anyPress = (i: InputReport | null) =>
  !!i &&
  (i.cross || i.circle || i.square || i.triangle || i.l1 || i.r1 || i.create || i.options || i.l3 || i.r3 || i.home || i.pad || i.mute || i.dpad !== 8 || i.triggerLeft > 60 || i.triggerRight > 60);

interface Step {
  key: string;
  target: string | null; // CSS selector; null = centered card, no spotlight
  // A hands-on step: done when this returns true.
  done?: (input: InputReport | null, view: PanelView) => boolean;
  // Put the app in the state this step talks about.
  enter?: (onView: (v: PanelView) => void) => void;
}

const STEPS: Step[] = [
  { key: "welcome", target: null, enter: (go) => go("overview") },
  { key: "press", target: ".live-ctl svg", done: (i) => anyPress(i) },
  { key: "trigger", target: ".live-ctl svg", done: (i) => !!i && (i.triggerLeft > 200 || i.triggerRight > 200) },
  { key: "click", target: '.live-ctl [data-part="lightbar"]', done: (_i, v) => typeof v === "object" && v.part === "lightbar" },
  { key: "panel", target: ".live-panel" },
  { key: "list", target: ".live-shortcuts", enter: (go) => go("overview") },
  { key: "save", target: ".dk-bar" },
  { key: "top", target: ".dk-top" },
  { key: "finish", target: null },
];

interface Props {
  input: InputReport | null;
  view: PanelView;
  onView: (view: PanelView) => void;
  // Auto-start only once a controller is there to play with.
  ready: boolean;
}

export default function Tour({ input, view, onView, ready }: Props) {
  const { t } = useTranslation();
  // null = not started by hand; the first run starts it by itself once a
  // controller is there (closed = dismissed in this session).
  const [chosen, setChosen] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The step whose hands-on task has been done (latched: letting go of the
  // button doesn't un-tick it).
  const [tickedStep, setTickedStep] = useState<number | null>(null);
  const index = chosen ?? (ready && !closed && !tourDone() ? 0 : null);

  const go = useCallback(
    (next: number) => {
      setChosen(next);
      STEPS[next].enter?.(onView);
    },
    [onView],
  );
  useEffect(() => {
    const start = () => {
      setClosed(false);
      go(0);
    };
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [go]);

  const step = index === null ? null : STEPS[index];
  const ticked = tickedStep === index;

  // Hands-on steps tick off when the controller (or the mouse) does the thing.
  const isDone = !!step?.done && step.done(input, view);
  useEffect(() => {
    if (!isDone || ticked || index === null) return;
    const frame = requestAnimationFrame(() => setTickedStep(index));
    return () => cancelAnimationFrame(frame);
  }, [isDone, ticked, index]);

  // Follow the target (layouts move: panels open, the window resizes).
  useLayoutEffect(() => {
    if (!step?.target) return;
    const measure = () => {
      const el = document.querySelector(step.target!);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const first = requestAnimationFrame(measure);
    const timer = setInterval(measure, 200);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [step]);
  const spot = step?.target ? rect : null;

  // A ticked hands-on step moves on by itself after a moment to enjoy it.
  useEffect(() => {
    if (!ticked || index === null || index >= STEPS.length - 1) return;
    const timer = setTimeout(() => go(index + 1), 1400);
    return () => clearTimeout(timer);
  }, [ticked, index, go]);

  const finish = useCallback(() => {
    markDone();
    setChosen(null);
    setClosed(true);
  }, []);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, finish]);

  if (index === null || !step) return null;
  const last = index === STEPS.length - 1;
  const handsOn = !!step.done;
  const next = () => (last ? finish() : go(index + 1));

  // The spotlight: a rounded hole in the dimmed screen (a huge shadow around
  // a transparent box), gliding between targets.
  const hole = spot
    ? { left: spot.left - PAD, top: spot.top - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2 }
    : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };

  // The card goes beside the spotlight where there's room, else centered.
  const cardW = 340;
  let card: React.CSSProperties;
  if (!spot) card = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  else if (window.innerWidth - (hole.left + hole.width) > cardW + 32) card = { left: hole.left + hole.width + 16, top: Math.max(16, Math.min(hole.top, window.innerHeight - 260)) };
  else if (hole.left > cardW + 32) card = { left: hole.left - cardW - 16, top: Math.max(16, Math.min(hole.top, window.innerHeight - 260)) };
  else if (window.innerHeight - (hole.top + hole.height) > 220) card = { left: Math.max(16, Math.min(hole.left, window.innerWidth - cardW - 16)), top: hole.top + hole.height + 16 };
  else card = { left: Math.max(16, Math.min(hole.left, window.innerWidth - cardW - 16)), top: Math.max(16, hole.top - 236) };

  return createPortal(
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div className={`tour-hole${spot ? "" : " none"}${handsOn && !ticked ? " pulse" : ""}`} style={hole} />
      <div className="tour-card" style={{ ...card, width: cardW }} key={index}>
        <div className="tour-step">{t("desktop.tour.stepOf", { n: index + 1, total: STEPS.length })}</div>
        <h2 id="tour-title">{t(`desktop.tour.${step.key}.title`)}</h2>
        <p>{t(`desktop.tour.${step.key}.body`)}</p>
        {handsOn && (
          <p className={`tour-task${ticked ? " ok" : ""}`} aria-live="polite">
            <span className="tour-check" aria-hidden="true">
              {ticked ? "✓" : ""}
            </span>
            {ticked ? t(`desktop.tour.${step.key}.done`) : t("desktop.tour.waiting")}
          </p>
        )}
        <div className="tour-actions">
          <button type="button" className="dk-btn" onClick={finish}>
            {t("desktop.tour.skip")}
          </button>
          <span className="dk-spacer" />
          {index > 0 && (
            <button type="button" className="dk-btn" onClick={() => go(index - 1)}>
              {t("desktop.tour.back")}
            </button>
          )}
          <button type="button" className={`dk-btn${!handsOn || ticked ? " primary" : ""}`} onClick={next}>
            {last ? t("desktop.tour.finishButton") : handsOn && !ticked ? t("desktop.tour.skipStep") : t("desktop.tour.next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
