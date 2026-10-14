// First-run guided tour: the screen dims, a spotlight glides from one part of
// the app to the next, and a card explains it. The hands-on steps wait for the
// real controller (press a button, pull a trigger) or the mouse (open a
// panel) and tick off when done. Shown once, the first time a controller is
// connected; replayable from App settings. Respects reduced motion (the CSS
// drops the glide and the pulse).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readPref, writePref } from "../storage";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { InputReport } from "../../oled/inputReport";
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";
import type { PanelView } from "../live/PartPanel";
import { narratorIdle, say, setNarrator, stopNarrator, useNarrator } from "../narrator";
import { useWindowShown } from "../useWindowShown";

const DONE_KEY = "ds5.tourDone";
// Off until the guide is rebuilt for the rail / console / library layout
// (it points at the old top bar): it neither starts on its own nor shows its
// "Show the tour again" card.
export const TOUR_ENABLED = false;
const PAD = 10;

export function tourDone(): boolean {
  return readPref(DONE_KEY) === "1";
}

// Storage blocked: the tour may show again next time.
const markDone = () => writePref(DONE_KEY, "1");

// App settings' "Show the tour again" asks for it through this event.
export const TOUR_EVENT = "ds5:start-tour";
export const startTour = () => window.dispatchEvent(new Event(TOUR_EVENT));

// The buttons held right now, by the symbol shown on the card.
const BUTTONS: Array<[label: string, held: (i: InputReport) => boolean]> = [
  ["✕", (i) => i.cross],
  ["○", (i) => i.circle],
  ["□", (i) => i.square],
  ["△", (i) => i.triangle],
  ["L1", (i) => i.l1],
  ["R1", (i) => i.r1],
  ["L2", (i) => i.triggerLeft > 60],
  ["R2", (i) => i.triggerRight > 60],
  ["L3", (i) => i.l3],
  ["R3", (i) => i.r3],
  ["↑", (i) => i.dpad === 7 || i.dpad === 0 || i.dpad === 1],
  ["→", (i) => i.dpad >= 1 && i.dpad <= 3],
  ["↓", (i) => i.dpad >= 3 && i.dpad <= 5],
  ["←", (i) => i.dpad >= 5 && i.dpad <= 7],
  ["Create", (i) => i.create],
  ["Options", (i) => i.options],
  ["PS", (i) => i.home],
  ["Touchpad", (i) => i.pad],
  ["Mute", (i) => i.mute],
];
// "Press any button" wants a few different ones, so there's time to play.
const PRESS_GOAL = 4;
// On the play steps ✕ and ○ are buttons to play with: moving on (✕) or back
// (○) takes holding one this long, with a ring filling on the card.
const HOLD_MS = 900;
// TriggersPage's preset list: 0 off, 1 feedback, 2 weapon, ...
const WEAPON_PRESET = 2;

const anyPress = (i: InputReport | null) =>
  !!i &&
  (i.cross || i.circle || i.square || i.triangle || i.l1 || i.r1 || i.create || i.options || i.l3 || i.r3 || i.home || i.pad || i.mute || i.dpad !== 8 || i.triggerLeft > 60 || i.triggerRight > 60);

interface Step {
  key: string;
  target: string | null; // CSS selector; null = centered card, no spotlight
  // A hands-on step: done when this returns true.
  done?: (input: InputReport | null, view: PanelView) => boolean;
  // Done with the controller (✕ then counts as the press); otherwise with
  // the mouse, and ✕ skips it.
  pad?: boolean;
  // Put the app in the state this step talks about.
  enter?: (onView: (v: PanelView) => void) => void;
}

const STEPS: Step[] = [
  { key: "welcome", target: null, enter: (go) => go("overview") },
  { key: "press", target: ".live-ctl svg", pad: true }, // done: PRESS_GOAL different buttons (below)
  { key: "trigger", target: ".live-ctl svg", pad: true, done: (i) => !!i && (i.triggerLeft > 200 || i.triggerRight > 200) },
  { key: "data", target: ".live-readouts" },
  // The spotlight frames the strips and the touchpad between them, so a
  // click on the touchpad counts too (and opens the lightbar, below).
  { key: "click", target: '.live-ctl [data-part="lightbar"]', done: (_i, v) => typeof v === "object" && (v.part === "lightbar" || v.part === "touchpad") },
  // (opens the lightbar's panel if the click step was skipped)
  { key: "panel", target: ".live-panel", enter: (go) => go({ part: "lightbar" }) },
  { key: "list", target: ".live-shortcuts", enter: (go) => go("overview") },
  { key: "save", target: ".dk-bar" },
  { key: "top", target: ".dk-top" },
  { key: "finish", target: null },
];

interface Props {
  // For the trigger step's surprise: an adaptive trigger effect while it's open.
  client: Ds5BridgeClient | null;
  input: InputReport | null;
  view: PanelView;
  onView: (view: PanelView) => void;
  // Auto-start only once a controller is there to play with.
  ready: boolean;
}

export default function Tour({ client, input, view, onView, ready }: Props) {
  const { t } = useTranslation();
  // null = not started by hand; the first run starts it by itself once a
  // controller is there (closed = dismissed in this session).
  const [chosen, setChosen] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The step whose hands-on task has been done (latched: letting go of the
  // button doesn't un-tick it).
  const [tickedStep, setTickedStep] = useState<number | null>(null);
  // The step during which the controller has been seen at rest: hands-on
  // steps only count a press that starts after the step appeared (the ✕ that
  // moved on to "press any button" mustn't tick it straight away).
  const [armedStep, setArmedStep] = useState<number | null>(null);
  const index = chosen ?? (TOUR_ENABLED && ready && !closed && !tourDone() ? 0 : null);

  const go = useCallback(
    (next: number) => {
      setChosen(next);
      STEPS[next].enter?.(onView);
    },
    [onView],
  );
  // lifetime: OK — cleanup removes the TOUR_EVENT listener (unmount)
  useEffect(() => {
    const start = () => {
      setClosed(false);
      go(0);
    };
    // lifetime: OK — removed in the effect cleanup (unmount)
    window.addEventListener(TOUR_EVENT, start);
    return () => window.removeEventListener(TOUR_EVENT, start);
  }, [go]);

  const step = index === null ? null : STEPS[index];
  const ticked = tickedStep === index;

  // The narrator: step 1 asks whether she should talk (her question is the
  // sample, through the controller); every step after that has her line, if
  // the answer was yes. A new step cuts the previous line off.
  const narrator = useNarrator();
  const asking = index === 0 && narrator === "ask";
  const narratorRef = useRef(narrator);
  // lifetime: OK — acquires nothing (mirrors state into a ref)
  useEffect(() => {
    narratorRef.current = narrator;
  });
  // lifetime: OK — acquires nothing (says one narrator line; the next step cuts it)
  useEffect(() => {
    if (index === null) return;
    const key = STEPS[index].key;
    if (key === "welcome") {
      void say("tour_welcome", { allowAsk: true, cut: true }).then(() => {
        if (narratorRef.current === "ask") void say("tour_voice_ask", { allowAsk: true });
      });
    } else void say(`tour_${key}`, { cut: true });
  }, [index]);
  // The trigger step's surprise: both triggers get the "Weapon" effect (they
  // resist, then snap through) while it's open; off again when it closes.
  const onTriggerStep = index !== null && STEPS[index].key === "trigger";

  // The click step: the strips pulse so it's clear what to click, and a click
  // on the touchpad (inside the spotlight) opens the lightbar instead.
  const onClickStep = index !== null && STEPS[index].key === "click";
  // lifetime: OK — cleanup removes the pulse class (step change, unmount)
  useEffect(() => {
    if (!onClickStep) return;
    document.querySelector('.live-ctl [data-part="lightbar"]')?.classList.add("tour-pulse");
    return () => document.querySelector('.live-ctl [data-part="lightbar"]')?.classList.remove("tour-pulse");
  }, [onClickStep]);
  // lifetime: OK — acquires nothing (opens the lightbar panel)
  useEffect(() => {
    if (onClickStep && typeof view === "object" && view.part === "touchpad") onView({ part: "lightbar" });
  }, [onClickStep, view, onView]);
  // lifetime: OK — cleanup turns the trigger preview off (step change, unmount)
  useEffect(() => {
    if (!onTriggerStep || !client) return;
    void client.previewTrigger(WEAPON_PRESET).catch(() => undefined);
    return () => void client.previewTrigger(0).catch(() => undefined);
  }, [onTriggerStep, client]);

  const answer = useCallback(
    (talk: boolean) => {
      setNarrator(talk ? "on" : "off");
      go(1);
    },
    [go],
  );

  // Hands-on steps tick off when the controller (or the mouse) does the thing.
  const idle = !anyPress(input);
  // lifetime: OK — cleanup cancels the frame
  useEffect(() => {
    if (index === null || armedStep === index || !idle) return;
    // lifetime: OK — one-shot, cancelled in the effect cleanup
    const frame = requestAnimationFrame(() => setArmedStep(index));
    return () => cancelAnimationFrame(frame);
  }, [idle, index, armedStep]);
  // Step 2 collects the different buttons pressed since it appeared.
  const [pressed, setPressed] = useState<{ step: number | null; labels: string[] }>({ step: null, labels: [] });
  // loop: HOT-PATH-OK — N = 19 buttons, 30 Hz input renders while the tour is open
  const heldNow = input ? BUTTONS.filter(([, held]) => held(input)).map(([label]) => label) : [];
  const heldKey = heldNow.join(",");
  // lifetime: OK — cleanup cancels the frame
  useEffect(() => {
    if (index === null || STEPS[index].key !== "press" || armedStep !== index || !heldKey) return;
    // lifetime: OK — one-shot, cancelled in the effect cleanup
    const frame = requestAnimationFrame(() =>
      setPressed((p) => {
        const base = p.step === index ? p.labels : [];
        // loop: HOT-PATH-OK — N <= 19 button labels, only when the held set changes on the press step
        const merged = [...base, ...heldKey.split(",").filter((l) => !base.includes(l))];
        return merged.length === base.length && p.step === index ? p : { step: index, labels: merged };
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [heldKey, index, armedStep]);
  const pressedLabels = pressed.step === index ? pressed.labels : [];
  const isDone = step?.key === "press" ? pressedLabels.length >= PRESS_GOAL : !!step?.done && armedStep === index && step.done(input, view);
  // lifetime: OK — cleanup cancels the frame
  useEffect(() => {
    if (!isDone || ticked || index === null) return;
    // lifetime: OK — one-shot, cancelled in the effect cleanup
    const frame = requestAnimationFrame(() => {
      setTickedStep(index);
      // Her reaction (if the step has one): after the step's own line.
      void say(`tour_${STEPS[index].key}_done`);
    });
    return () => cancelAnimationFrame(frame);
  }, [isDone, ticked, index]);

  // Hold-to-continue on the play steps: which button is held, since when, and
  // the ring's progress (0..1) for the card.
  const hold = useRef<{ btn: "cross" | "circle"; since: number } | null>(null);
  const [holdProgress, setHoldProgress] = useState<{ btn: "cross" | "circle"; p: number } | null>(null);

  // Follow the target (layouts move: panels open, the window resizes), only
  // while the window is on screen; measured again on show.
  const shown = useWindowShown();
  // lifetime: OK — cleanup cancels the frame, the interval and the resize listener; off while hidden
  useLayoutEffect(() => {
    if (!step?.target || !shown) return;
    const measure = () => {
      const el = document.querySelector(step.target!);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    // lifetime: OK — one-shot, cancelled in the layout effect cleanup
    const first = requestAnimationFrame(measure);
    // lifetime: OK — cleared in the cleanup (step change, window hidden, tour closed)
    const timer = setInterval(measure, 200);
    // lifetime: OK — removed in the layout effect cleanup
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [step, shown]);
  const spot = step?.target ? rect : null;

  const finish = useCallback(() => {
    stopNarrator();
    markDone();
    setChosen(null);
    setClosed(true);
  }, []);

  // Console-style: ✕ continues, ○ goes back (on the press, not while held).
  // On a controller step that isn't done yet, ✕ is just a press for the
  // task; on a mouse step it skips it.
  const current = useRef({ index, padTask: false, ticked: false, asking: false });
  // lifetime: OK — acquires nothing (mirrors state into a ref)
  useEffect(() => {
    current.current = { index, padTask: !!step?.pad, ticked, asking };
  });
  const pad = useRef({ cross: false, circle: false });
  // lifetime: OK — acquires nothing (edge-detects the pad buttons)
  useEffect(() => {
    const was = pad.current;
    const cross = !!input?.cross;
    const circle = !!input?.circle;
    pad.current = { cross, circle };
    const { index: i, padTask, asking: ask } = current.current;
    if (i === null) return;
    // The narrator question: ✕ yes, ○ no.
    if (ask) {
      if (cross && !was.cross) answer(true);
      else if (circle && !was.circle) answer(false);
      return;
    }
    if (padTask) {
      // Holding, not tapping: the ring effect below acts once it fills.
      if (cross && !was.cross) hold.current = { btn: "cross", since: Date.now() };
      else if (circle && !was.circle && i > 0) hold.current = { btn: "circle", since: Date.now() };
      if ((hold.current?.btn === "cross" && !cross) || (hold.current?.btn === "circle" && !circle)) hold.current = null;
      return;
    }
    if (cross && !was.cross) {
      if (i >= STEPS.length - 1) finish();
      else go(i + 1);
    } else if (circle && !was.circle && i > 0) go(i - 1);
  }, [input, go, finish, answer]);

  // While ✕ or ○ is held on a play step: fill the ring, then move on / back.
  // A per-frame loop, so only while the window is on screen.
  // lifetime: OK — cleanup cancels the hold loop (step change, window hidden, tour closed)
  useEffect(() => {
    if (index === null || !STEPS[index].pad || !shown) return;
    let frame = 0;
    const tick = () => {
      const h = hold.current;
      if (h) {
        const p = Math.min(1, (Date.now() - h.since) / HOLD_MS);
        setHoldProgress({ btn: h.btn, p });
        if (p >= 1) {
          hold.current = null;
          setHoldProgress(null);
          if (h.btn === "cross") go(index + 1);
          else go(index - 1);
          return;
        }
      } else setHoldProgress((v) => (v ? null : v));
      // lifetime: WASTE — re-arms every frame for the whole pad step, even with no button held
      frame = requestAnimationFrame(tick);
    };
    // lifetime: OK — cancelled in the effect cleanup
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [index, go, shown]);

  // A ticked mouse step moves on by itself after a moment, but never over
  // her: it waits for the current line to finish (the next step's line would
  // cut it off). Controller steps wait for ✕ to be held instead.
  // lifetime: OK — cleanup clears the timer and drops a late narratorIdle()
  useEffect(() => {
    if (!ticked || index === null || index >= STEPS.length - 1 || STEPS[index].pad) return;
    let cancelled = false;
    // lifetime: OK — cleared in the effect cleanup
    const timer = setTimeout(() => {
      void narratorIdle().then(() => !cancelled && go(index + 1));
    }, 1400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticked, index, go]);

  // lifetime: OK — cleanup removes the keydown listener (tour closed, unmount)
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    // lifetime: OK — removed in the effect cleanup
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, finish]);

  if (index === null || !step) return null;
  const last = index === STEPS.length - 1;
  const handsOn = !!step.done || step.key === "press";
  const next = () => (last ? finish() : go(index + 1));

  // The spotlight: a rounded hole in the dimmed screen (a huge shadow around
  // a transparent box), gliding between targets.
  const hole = spot
    ? { left: spot.left - PAD, top: spot.top - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2 }
    : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };

  // The card goes beside the spotlight where there's room, else centered.
  const cardW = asking ? 380 : 340;
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
        {asking ? (
          <>
            <p>{t("desktop.tour.welcome.bodyAsk")}</p>
            <p className="tour-voice">{t("desktop.tour.voiceAsk")}</p>
          </>
        ) : (
          <p>{t(`desktop.tour.${step.key}.body`)}</p>
        )}
        {handsOn && (
          <p className={`tour-task${ticked ? " ok" : ""}`} aria-live="polite">
            <span className="tour-check" aria-hidden="true">
              {ticked ? "✓" : ""}
            </span>
            {ticked ? t(`desktop.tour.${step.key}.done`) : step.key === "press" ? t("desktop.tour.pressGoal", { n: PRESS_GOAL - pressedLabels.length }) : t("desktop.tour.waiting")}
          </p>
        )}
        {step.key === "press" && pressedLabels.length > 0 && (
          <p className="tour-chips" aria-label={t("desktop.tour.pressedLabel")}>
            {/* loop: HOT-PATH-OK — N ≤ 4 chips (PRESS_GOAL), per input render during the tour */}
            {pressedLabels.map((l) => (
              <span key={l} className="tour-chip">
                {l}
              </span>
            ))}
          </p>
        )}
        {step.pad && <p className="dk-hint">{ticked ? t("desktop.tour.keepPlaying") : t("desktop.tour.holdHint")}</p>}
        <div className={`tour-actions${asking ? " asking" : ""}`}>
          <button type="button" className="dk-btn" onClick={finish}>
            {t("desktop.tour.skip")}
          </button>
          <span className="dk-spacer" />
          {index > 0 && (
            <button type="button" className="dk-btn" onClick={() => go(index - 1)}>
              {input && (
                <span className={`tour-glyph circle${step.pad ? " hold" : ""}`} aria-hidden="true" style={{ "--hold": holdProgress?.btn === "circle" ? holdProgress.p : 0 } as React.CSSProperties}>
                  ○
                </span>
              )}
              {t("desktop.tour.back")}
            </button>
          )}
          {asking ? (
            <>
              <button type="button" className="dk-btn" onClick={() => answer(false)}>
                {input && (
                  <span className="tour-glyph circle" aria-hidden="true">
                    ○
                  </span>
                )}
                {t("desktop.tour.voiceNo")}
              </button>
              <button type="button" className="dk-btn primary" onClick={() => answer(true)}>
                {input && (
                  <span className="tour-glyph cross" aria-hidden="true">
                    ✕
                  </span>
                )}
                {t("desktop.tour.voiceYes")}
              </button>
            </>
          ) : (
            <button type="button" className={`dk-btn${!handsOn || ticked ? " primary" : ""}`} onClick={next}>
              {input && (
                <span className={`tour-glyph cross${step.pad ? " hold" : ""}`} aria-hidden="true" style={{ "--hold": holdProgress?.btn === "cross" ? holdProgress.p : 0 } as React.CSSProperties}>
                  ✕
                </span>
              )}
              {last ? t("desktop.tour.finishButton") : handsOn && !ticked ? t("desktop.tour.skipStep") : t("desktop.tour.next")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
