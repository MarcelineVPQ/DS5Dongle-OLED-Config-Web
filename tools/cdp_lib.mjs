// The DevTools (CDP) client the app's measuring and smoke scripts share
// (tools/measure_budgets.mjs, tools/mac_smoke.mjs): a socket with numbered
// requests and event handlers, and evaluation in the page and in the
// Electron main process (its --inspect port). Platform-neutral: Node 22's
// built-in WebSocket only.
/* global WebSocket -- Node 22's built-in client */
import { setTimeout as sleep } from "node:timers/promises";
import { FRAME_MARKS, framesBetweenMarks } from "./budgets_lib.mjs";

// A CDP session on a target's webSocketDebuggerUrl: send(method, params)
// answers with the reply; `handlers` get every event.
export async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  let id = 0;
  const wait = new Map();
  const handlers = new Set();
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) {
      wait.get(d.id)(d);
      wait.delete(d.id);
    } else handlers.forEach((h) => h(d));
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      wait.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return { send, handlers, close: () => ws.close() };
}

// Evaluation helpers over a page session and a main-process session:
// ev (the page), mainEv (main, require() available) and win (a body run
// with `w` = the app's first BrowserWindow). Exceptions are thrown.
export function evaluators(page, main) {
  async function ev(expression) {
    const r = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`page: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
    return r.result?.result?.value;
  }
  async function mainEv(expression) {
    const r = await main.send("Runtime.evaluate", { expression, includeCommandLineAPI: true, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`main: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
    return r.result?.result?.value;
  }
  const win = (body) => mainEv(`(() => { const w = require("electron").BrowserWindow.getAllWindows()[0]; ${body} })()`);
  return { ev, mainEv, win };
}

// Frames drawn per second over `secs` (a trace's Display::DrawAndSwap
// events), to 0.1. Only the frames between two marks the page puts in the
// trace (console.timeStamp) `secs` apart count, not the whole trace: the
// trace runs on in the GPU process for a moment after Tracing.end (201
// frames in "20 s" at exactly 100 ms apart). framesBetweenMarks
// (budgets_lib.mjs) turns them into a rate.
export async function framesOver(page, secs) {
  const events = [];
  let done;
  const finished = new Promise((r) => (done = r));
  const h = (d) => {
    if (d.method === "Tracing.dataCollected") for (const e of d.params.value) if (e.name === "Display::DrawAndSwap" || e.name === "TimeStamp") events.push(e);
    if (d.method === "Tracing.tracingComplete") done();
  };
  page.handlers.add(h);
  await page.send("Tracing.start", {
    traceConfig: { includedCategories: ["viz", "disabled-by-default-devtools.timeline.frame", "devtools.timeline"], recordMode: "recordContinuously" },
    transferMode: "ReportEvents",
  });
  const mark = (name) => page.send("Runtime.evaluate", { expression: `console.timeStamp(${JSON.stringify(name)})` });
  await mark(FRAME_MARKS.start);
  await sleep(secs * 1000);
  await mark(FRAME_MARKS.end);
  await page.send("Tracing.end");
  await finished;
  page.handlers.delete(h);
  const perS = framesBetweenMarks(events);
  // No marks in the trace: say so rather than judge a number that wasn't measured.
  if (perS === null) throw new Error("the frame trace has no start/end marks (console.timeStamp didn't reach it)");
  return perS;
}
