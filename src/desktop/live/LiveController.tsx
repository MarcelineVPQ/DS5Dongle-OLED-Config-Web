// The live DualSense: AL2009man's art (src/assets/dualsense.svg, prepared by
// tools/prepare_controller_art.py) with the controller's state painted on it.
// Pressed buttons light up, L2/R2 fill with the pull, sticks move, touches
// show on the touchpad and the lightbar takes the controller's color. Every
// part is a button that selects it for the side panel.
//
// The art is inlined once; live updates touch the existing SVG elements
// directly (classes, attributes) instead of re-rendering 180 KB of markup
// 30 times a second.
import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import art from "../../assets/dualsense.svg?raw";
import type { InputReport } from "../../oled/inputReport";
import type { ColorwayColors } from "./colorways";
import { PART_IDS, type PartId } from "./parts";

const STICK_TRAVEL = 9; // viewBox units at full deflection
const TOUCH_W = 1920;
const TOUCH_H = 1080;

interface Props {
  input: InputReport | null;
  lightbar: [number, number, number] | null;
  playerLeds: number; // bits 0..4, left to right (as the PC set them)
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
  ];
  for (const [down, part] of map) if (down) on.add(part);
  return on;
}

export default function LiveController({ input, lightbar, playerLeds, colors, selected, remapped, onSelect }: Props) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const parts = useRef(new Map<PartId, SVGGraphicsElement>());
  // The art's own transform per stick group; live movement is applied on top of it.
  const baseTransform = useRef(new Map<PartId, string>());
  const touchLayer = useRef<SVGGElement | null>(null);

  // Index the parts once and make each one a keyboard-reachable button.
  useLayoutEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    root.setAttribute("role", "group");
    for (const id of PART_IDS) {
      const el = root.querySelector<SVGGraphicsElement>(`[data-part="${id}"]`);
      if (!el) continue;
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
      parts.current.set(id, el);
      baseTransform.current.set(id, el.getAttribute("transform") ?? "");
    }
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("class", "touches");
    root.appendChild(layer);
    touchLayer.current = layer;
  }, []);

  // Accessible names follow the language.
  useEffect(() => {
    for (const [id, el] of parts.current) el.setAttribute("aria-label", t(`desktop.live.part.${id}`));
  }, [t]);

  useEffect(() => {
    for (const [id, el] of parts.current) {
      el.classList.toggle("sel", id === selected);
      el.setAttribute("aria-pressed", String(id === selected));
      el.classList.toggle("remapped", remapped.has(id));
    }
  }, [selected, remapped]);

  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (root) root.style.setProperty("--ctl-led", lightbar ? `rgb(${lightbar[0]}, ${lightbar[1]}, ${lightbar[2]})` : "");
  }, [lightbar]);

  // The connected controller's own colors (else the CSS theme defaults).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const vars: Array<[string, string | undefined]> = [
      ["--ctl-body", colors?.body],
      ["--ctl-cap", colors?.cap],
      ["--ctl-dark", colors?.dark],
      ["--ctl-stick", colors?.stick],
      ["--ctl-line", colors?.line],
    ];
    for (const [name, value] of vars) {
      if (value) el.style.setProperty(name, value);
      else el.style.removeProperty(name);
    }
  }, [colors]);

  // Player indicator: the pattern the PC set (player 1 = center light, ...).
  useEffect(() => {
    const leds = host.current?.querySelectorAll("[data-led]");
    leds?.forEach((led) => led.classList.toggle("on", (playerLeds & (1 << Number(led.getAttribute("data-led")))) !== 0));
  }, [playerLeds]);

  // Live state.
  useEffect(() => {
    const root = host.current?.querySelector("svg");
    if (!root) return;
    root.classList.toggle("live", !!input);
    const on = input ? pressed(input) : new Set<PartId>();
    for (const [id, el] of parts.current) el.classList.toggle("on", on.has(id));
    // The mute button's light: amber while the mic is muted, like the real one.
    parts.current.get("mute")?.classList.toggle("muted", !!input?.micMuted);

    for (const [side, value] of [
      ["l2", input?.triggerLeft ?? 0],
      ["r2", input?.triggerRight ?? 0],
    ] as const) {
      const offset = String(value / 255);
      for (const stop of root.querySelectorAll(`#ctl-${side}-fill [data-edge]`)) stop.setAttribute("offset", offset);
    }

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
    const pad = parts.current.get("touchpad");
    if (layer && pad) {
      const [bx, by, bw, bh] = (pad.getAttribute("data-box") ?? "0 0 0 0").split(" ").map(Number);
      const box = { x: bx, y: by, w: bw, h: bh };
      const dots = (input?.fingers ?? []).filter((f) => f.touching);
      while (layer.childNodes.length > dots.length) layer.lastChild?.remove();
      while (layer.childNodes.length < dots.length) layer.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "circle"));
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
    else if ((target as Element | null)?.closest?.(".bd, .dk")) onSelect("body");
  };

  return (
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
      dangerouslySetInnerHTML={{ __html: art /* sink-allowed: bundled build-time SVG asset (src/assets/dualsense.svg) */ }}
    />
  );
}
