// Does the swirl background (SwirlField.tsx) animate? Only when its shader runs
// on a real graphics card. Without one (hardware acceleration off, WebGL2
// missing or blocklisted, or WebGL drawn in software: SwiftShader, llvmpipe,
// Windows' Basic Render Driver, Apple's software renderer) the swirl is drawn
// once, still (the same look, no motion), and redrawn only when its colors or
// the theme change: on the CPU it must not burn CPU (the lean rule, CLAUDE.md
// "Resource budgets"; owner's decision delegated 2026-10-15, LOOP_PASS_2026-10.md).

// Renderer strings of software rasterizers, as WebGL reports them on Linux,
// Windows and macOS (directly or inside ANGLE's "ANGLE (vendor, renderer, api)"):
// SwiftShader (Chromium's own fallback, also "Subzero"), Mesa's llvmpipe,
// softpipe and lavapipe, Windows' WARP ("Microsoft Basic Render Driver"),
// Apple's "Apple Software Renderer", and generic "Software Rasterizer/Adapter".
const SOFTWARE_RENDERER = /swiftshader|subzero|llvmpipe|softpipe|lavapipe|basic render driver|software (rasterizer|renderer|adapter)|mesa offscreen/i;

export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  return !!renderer && SOFTWARE_RENDERER.test(renderer);
}

// What the probe found: a WebGL2 context at all, one created with
// failIfMajorPerformanceCaveat (Chromium refuses it when WebGL would be drawn
// in software), and the unmasked renderer string (null when not exposed).
export interface GpuProbe {
  webgl2: boolean;
  fast: boolean;
  renderer: string | null;
}
export type GpuKind = "hardware" | "software" | "none";

// Either sign of software rendering is enough: the caveat check catches a
// renderer whose name we don't know, the name catches a software renderer
// Chromium doesn't flag (llvmpipe through the system's GL).
export function classifyGpu(p: GpuProbe): GpuKind {
  if (!p.webgl2) return "none";
  return !p.fast || isSoftwareRenderer(p.renderer) ? "software" : "hardware";
}

// "gpu": the shader, animated. "cpu": one still frame (the CPU fallback), so
// nothing runs per frame. `forceGpu` (dev builds, `ds5.dev.swirlGpu`) keeps
// the animated shader on a software renderer: the budget gate measures the
// GPU path on SwiftShader as a stand-in for a real card.
export function swirlMode(o: { hardwareAcceleration: boolean; gpu: GpuKind; forceGpu?: boolean }): "gpu" | "cpu" {
  if (!o.hardwareAcceleration || o.gpu === "none") return "cpu";
  return o.gpu === "hardware" || o.forceGpu ? "gpu" : "cpu";
}

// The probe itself (the browser's side; classifyGpu above is the tested logic).
// Two throwaway canvases: one canvas holds one context with one set of attributes.
export function probeGpu(): GpuProbe {
  const opts: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, powerPreference: "low-power" };
  const gl = document.createElement("canvas").getContext("webgl2", opts);
  if (!gl || gl.isContextLost()) return { webgl2: false, fast: false, renderer: null };
  const fastGl = document.createElement("canvas").getContext("webgl2", { ...opts, failIfMajorPerformanceCaveat: true });
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "") || null;
  const probe = { webgl2: true, fast: !!fastGl && !fastGl.isContextLost(), renderer };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  fastGl?.getExtension("WEBGL_lose_context")?.loseContext();
  return probe;
}
