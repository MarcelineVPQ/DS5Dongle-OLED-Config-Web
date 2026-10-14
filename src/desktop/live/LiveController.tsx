// The live DualSense: AL2009man's art (src/assets/dualsense.svg, prepared by
// tools/prepare_controller_art.py), or for a DualSense Edge daidr's
// (src/assets/dualsense-edge.svg, tools/prepare_edge_art.py), with the
// controller's state painted on it.
// Pressed buttons light up, L2/R2 fill with the pull, sticks move, touches
// show on the touchpad and the lightbar takes the controller's color. Every
// part is a button that selects it for the side panel. Under the mute button,
// by the headset jack on the bottom edge: "Mic muted" while its light is on
// and "Headset in" while headphones are plugged into the controller.
//
// The art is inlined once; live updates touch the existing SVG elements
// directly (classes, attributes) instead of re-rendering 180 KB of markup
// 30 times a second.
import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Headphones, MicOff } from "lucide-react";
import dualsenseArt from "../../assets/dualsense.svg?raw";
import edgeArt from "../../assets/dualsense-edge.svg?raw";
import type { InputReport } from "../../oled/inputReport";
import { litPlayerLights, type PlayerLightWiring } from "../../protocol/controllerInfo";
import { lineOnDark, type ColorwayColors } from "./colorways";
import { hexToRgb, wantsLightInk } from "../theme/desktopPalette";
import { PART_IDS, type PartId } from "./parts";

const STICK_TRAVEL = 9; // viewBox units at full deflection
const TOUCH_W = 1920;
const TOUCH_H = 1080;

interface Props {
  model: "dualsense" | "edge" | null; // which drawing (null: the standard one)
  input: InputReport | null;
  lightbar: [number, number, number] | null;
  playerLeds: number; // the pattern the PC set (bits 0..4)
  playerWiring: PlayerLightWiring; // how the connected controller lights them
  colors: ColorwayColors | null; // the connected controller's colorway, null = theme colors
  selected: PartId | null;
  remapped: ReadonlySet<PartId>;
  onSelect: (part: PartId) => void;
}

// D-pad hat value (0 = up, clockwise, 8 = released) -> the directions held.
const DPAD: Record<number, PartId[]> = {
  0: ["dpad-up"],
  1: ["dpad-up", "dpad-right"],
  2: ["dpad-right"],
  3: ["dpad-down", "dpad-right"],
  4: ["dpad-down"],
  5: ["dpad-down", "dpad-left"],
  6: ["dpad-left"],
  7: ["dpad-up", "dpad-left"],
};

function pressed(input: InputReport): Set<PartId> {
  const on = new Set<PartId>(DPAD[input.dpad] ?? []);
  const map: Array<[boolean, PartId]> = [
    [input.cross, "cross"],
    [input.circle, "circle"],
    [input.square, "square"],
    [input.triangle, "triangle"],
    [input.l1, "l1"],
    [input.r1, "r1"],
    [input.l2, "l2"],
    [input.r2, "r2"],
    [input.create, "create"],
    [input.options, "options"],
    [input.l3, "stick-l"],
    [input.r3, "stick-r"],
    [input.home, "ps"],
    [input.pad, "touchpad"],
    [input.mute, "mute"],
    // DualSense Edge only (always false on a standard DualSense)
    [input.fnLeft, "fn-l"],
    [input.fnRight, "fn-r"],
    [input.backLeft, "paddle-l"],
    [input.backRight, "paddle-r"],
  ];
  for (const [down, part] of map) if (down) on.add(part);
  return on;
}

// One drawing per model; another model mounts its drawing afresh (the parts
// are indexed once per drawing).
export default function LiveController(props: Props) {
  const edge = props.model === "edge";
  return <LiveArt key={edge ? "edge" : "dualsense"} art={edge ? edgeArt : dualsenseArt} {...props} />;
}

function LiveArt({ art, input, lightbar, playerLeds, playerWiring, colors, selected, remapped, onSelect }: Props & { art: string }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const parts = useRef(new Map<PartId, SVGGraphicsElement>());
  // The art's own transform per stick group; live movement is applied on top of it.
  const baseTransform = useRef(new Map<PartId, string>());
  const touchLayer = useRef<SVGGElement | null>(null);
  // Looked up once at mount, not on every live frame: the triggers' fill
  // gradient stops (and the value they show now), and the touchpad's box.
  const triggerStops = useRef<Record<"l2" | "r2", Element[]>>({ l2: [], r2: [] });
  const triggerShown = useRef<Record<"l2" | "r2", number>>({ l2: -1, r2: -1 });
  const padBox = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const marks = useRef<HTMLDivElement>(null);

  // Index the parts once and make each one a keyboard-reachable button.
  // lifetime: OK — acquires nothing (indexes the drawing's parts; they go with its DOM)
  useLayoutEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    root.setAttribute("role", "group");
    // The body has no data-part of its own (it's the whole shell): give it a
    // keyboard stop too, so haptics can be reached without a mouse.
    const body = root.querySelector<SVGGraphicsElement>(".bd");
    if (body) {
      body.setAttribute("data-part", "body");
      body.setAttribute("tabindex", "0");
      body.setAttribute("role", "button");
    }
    // loop: NOT-WORTH — once per mount, N ≈ 30 parts
    for (const id of PART_IDS) {
      const el = root.querySelector<SVGGraphicsElement>(`[data-part="${id}"]`);
      if (!el) continue;
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
      parts.current.set(id, el);
      baseTransform.current.set(id, el.getAttribute("transform") ?? "");
    }
    // The light strips run along the touchpad's edges: keep them above its
    // click area, or clicking a strip opens the touchpad instead.
    const strips = parts.current.get("lightbar");
    if (strips) root.appendChild(strips);
    // Decorative outlines that belong to no part (the touchpad's edge, the
    // shell seams) let clicks through to whatever is under them.
    // loop: NOT-WORTH — once per mount, a few dozen outlines
    for (const line of root.querySelectorAll<SVGElement>(".ln")) if (!line.closest("[data-part]")) line.style.pointerEvents = "none";
    // (the player lights sit on the bottom strip, so they stay above it)
    const pled = root.querySelector(".pled");
    if (pled) root.appendChild(pled);
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("class", "touches");
    root.appendChild(layer);
    touchLayer.current = layer;
    // loop: NOT-WORTH — N = 2 triggers, once per mount
    for (const side of ["l2", "r2"] as const) triggerStops.current[side] = [...root.querySelectorAll(`#ctl-${side}-fill [data-edge]`)];
    // loop: NOT-WORTH — N = 4 numbers, once per mount
    const [bx, by, bw, bh] = (parts.current.get("touchpad")?.getAttribute("data-box") ?? "0 0 0 0").split(" ").map(Number);
    padBox.current = { x: bx, y: by, w: bw, h: bh };
  }, []);

  // The mic / headset marks sit under the mute button, just below the shell's
  // bottom edge (where the headset jack is); placed again only when the
  // drawing's size changes.
  // lifetime: OK — cleanup: disconnects the ResizeObserver
  useLayoutEffect(() => {
    const el = host.current;
    const box = marks.current;
    const mute = parts.current.get("mute");
    if (!el || !box || !mute) return;
    // loop: NOT-WORTH — once per mount, a few shell shapes
    const shell = [...el.querySelectorAll(".bd, .dk")].filter((s): s is SVGGeometryElement => s instanceof SVGGeometryElement);
    const place = () => {
      const origin = el.getBoundingClientRect();
      const m = mute.getBoundingClientRect();
      const x = m.left + m.width / 2;
      // Walk down from the button until no shell part is filled there.
      const toLocal = shell.map((s) => [s, s.getScreenCTM()?.inverse()] as const);
      const filled = (y: number) => toLocal.some(([s, inv]) => inv && s.isPointInFill(new DOMPoint(x, y).matrixTransform(inv)));
      let y = m.bottom;
      while (y < origin.bottom && filled(y)) y++;
      box.style.left = `${x - origin.left}px`;
      box.style.top = `${y + 3 - origin.top}px`;
    };
    // lifetime: OK — disconnected in the effect cleanup
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Accessible names follow the language.
  // lifetime: OK — acquires nothing (sets the parts' names)
  useEffect(() => {
    // loop: NOT-WORTH — N ≈ 30 parts, only when the language changes
    for (const [id, el] of parts.current) el.setAttribute("aria-label", t(`desktop.live.part.${id}`));
    host.current?.querySelector('[data-part="body"]')?.setAttribute("aria-label", t("desktop.live.part.body"));
    host.current?.querySelector("svg")?.setAttribute("aria-label", t("desktop.live.overview", "Your controller"));
  }, [t]);

  // lifetime: OK — acquires nothing (marks the selected part)
  useEffect(() => {
    // loop: NOT-WORTH — N ≈ 30 parts, only on selection/remap change
    for (const [id, el] of parts.current) {
      el.classList.toggle("sel", id === selected);
      el.setAttribute("aria-pressed", String(id === selected));
      el.classList.toggle("remapped", remapped.has(id));
    }
  }, [selected, remapped]);

  // The lightbar like the real one: its color at full strength, mixed with
  // the unlit grey plastic by how bright it is (off = plain grey, dim = a
  // tinted grey), and a glow that fades with it.
  // lifetime: OK — acquires nothing (sets the lightbar color tokens)
  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    const peak = lightbar ? Math.max(...lightbar) : 0;
    if (!lightbar || peak === 0) {
      root.style.setProperty("--ctl-led", "transparent");
      root.style.setProperty("--ctl-led-pct", "0%");
      return;
    }
    // loop: HOT-PATH-OK — N = 3 channels, on lightbar change (≤ 10 Hz)
    const full = lightbar.map((c) => Math.round((c * 255) / peak)).join(", ");
    root.style.setProperty("--ctl-led", `rgb(${full})`);
    root.style.setProperty("--ctl-led-pct", `${Math.round((peak / 255) * 100)}%`);
  }, [lightbar]);

  // The connected controller's own colors (else the CSS theme defaults).
  // lifetime: OK — acquires nothing (sets the colorway tokens)
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const vars: Array<[string, string | undefined]> = [
      ["--ctl-body", colors?.body],
      ["--ctl-cap", colors?.cap],
      ["--ctl-dark", colors?.dark],
      ["--ctl-stick", colors?.stick],
      ["--ctl-line", colors?.line],
      ["--ctl-line-dark", colors ? lineOnDark(colors) : undefined],
      // A press darkens light buttons and lightens dark ones (grayscale, so
      // it shows on every colorway, unlike an accent color).
      ["--ctl-press-ink", colors ? (wantsLightInk(hexToRgb(colors.cap)) ? "#ffffff" : "#000000") : undefined], // theme-exempt: the drawing's press tint
    ];
    // loop: NOT-WORTH — N = 7 CSS vars, only when the colorway changes
    for (const [name, value] of vars) {
      if (value) el.style.setProperty(name, value);
      else el.style.removeProperty(name);
    }
  }, [colors]);

  // Player indicator: the lights the PC's pattern turns on (player 1 = center light, ...).
  // lifetime: OK — acquires nothing (toggles the player lights)
  useEffect(() => {
    const lit = litPlayerLights(playerLeds, playerWiring);
    const leds = host.current?.querySelectorAll("[data-led]");
    leds?.forEach((led) => led.classList.toggle("on", (lit & (1 << Number(led.getAttribute("data-led")))) !== 0));
  }, [playerLeds, playerWiring]);

  // Live state.
  // lifetime: OK — acquires nothing lasting (touch dots reused, removed when lifted)
  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    root.classList.toggle("live", !!input);
    const on = input ? pressed(input) : new Set<PartId>();
    // loop: HOT-PATH-OK — N ≈ 30 parts, classList.toggle per live frame
    for (const [id, el] of parts.current) el.classList.toggle("on", on.has(id));
    // The mute button's light: amber while the mic is muted, like the real one.
    parts.current.get("mute")?.classList.toggle("muted", !!input?.micMuted);

    // loop: HOT-PATH-OK — N = 2 triggers per live frame
    for (const [side, value] of [
      ["l2", input?.triggerLeft ?? 0],
      ["r2", input?.triggerRight ?? 0],
    ] as const) {
      if (triggerShown.current[side] === value) continue;
      triggerShown.current[side] = value;
      const offset = String(value / 255);
      // loop: HOT-PATH-OK — N = 2 stops per trigger, looked up at mount; only when the value changed
      for (const stop of triggerStops.current[side]) stop.setAttribute("offset", offset);
    }

    // loop: HOT-PATH-OK — N = 2 sticks per live frame
    for (const [id, stick] of [
      ["stick-l", input?.leftStick],
      ["stick-r", input?.rightStick],
    ] as const) {
      const el = parts.current.get(id);
      if (!el) continue;
      const dx = stick ? ((stick.x - 128) / 128) * STICK_TRAVEL : 0;
      const dy = stick ? ((stick.y - 128) / 128) * STICK_TRAVEL : 0;
      // Translate first (parent coordinates), then the art's own placement.
      el.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)}) ${baseTransform.current.get(id) ?? ""}`.trim());
    }

    const layer = touchLayer.current;
    const box = padBox.current;
    if (layer && box) {
      // loop: HOT-PATH-OK — N ≤ 2 fingers per live frame
      const dots = (input?.fingers ?? []).filter((f) => f.touching);
      // loop: HOT-PATH-OK — N ≤ 2 touch dots removed
      while (layer.childNodes.length > dots.length) layer.lastChild?.remove();
      // loop: HOT-PATH-OK — N ≤ 2 touch dots added
      while (layer.childNodes.length < dots.length) layer.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "circle"));
      // loop: HOT-PATH-OK — N ≤ 2 touch dots placed
      dots.forEach((f, i) => {
        const c = layer.childNodes[i] as SVGCircleElement;
        c.setAttribute("cx", (box.x + (f.x / TOUCH_W) * box.w).toFixed(1));
        c.setAttribute("cy", (box.y + (f.y / TOUCH_H) * box.h).toFixed(1));
        c.setAttribute("r", "6");
      });
    }
  }, [input]);

  const pick = (target: EventTarget | null) => {
    const el = (target as Element | null)?.closest?.("[data-part]");
    const id = el?.getAttribute("data-part") as PartId | null;
    if (id && (PART_IDS as readonly string[]).includes(id)) onSelect(id);
    // The body and the dark plastic (grips, center) open haptics; only inside
    // the drawing (the app's own wrapper also has a "dk" class).
    else if ((target as Element | null)?.closest?.(".live-ctl svg .bd, .live-ctl svg .dk")) onSelect("body");
  };

  return (
    <div className="live-ctl-wrap">
      <div
        ref={host}
        className="live-ctl"
        onClick={(e) => pick(e.target)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pick(e.target);
          }
        }}
        dangerouslySetInnerHTML={{ __html: art /* sink-allowed: bundled build-time SVG asset (src/assets/dualsense.svg or dualsense-edge.svg) */ }}
      />
      <div ref={marks} className="live-marks">
        {input?.micMuted && (
          <span className="live-mark live-title-label">
            <MicOff size={12} aria-hidden="true" />
            {t("desktop.liveData.muted")}
          </span>
        )}
        {input?.headphones && (
          <span className="live-mark live-title-label">
            <Headphones size={12} aria-hidden="true" />
            {t("desktop.live.headsetIn")}
          </span>
        )}
      </div>
    </div>
  );
}
