// Developer: which HDR path actually reaches this display. Three swatches,
// each asking for light ~4x brighter than paper white, beside a normal white
// reference. On an HDR display, a swatch that works glows clearly brighter
// than the reference; one that doesn't looks the same (clamped to SDR).
// Screenshots can't show it (captured as SDR), so a person has to look.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { logged } from "../../errorText";

const BOOST = 4; // x SDR white

// The few WebGPU calls used here (no @webgpu/types dependency for one test).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Gpu = { requestAdapter(): Promise<{ requestDevice(): Promise<any> } | null> };
type GpuContext = { configure(c: Record<string, unknown>): void; getCurrentTexture(): { createView(): unknown } };
/* eslint-enable @typescript-eslint/no-explicit-any */

// WebGPU canvas in extended tone mapping: values above 1.0 are HDR.
function GpuSwatch() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  // lifetime: OK — cleanup: destroys the WebGPU device (lifetime pass batch 4), at once if it arrives after unmount
  useEffect(() => {
    let live = true;
    let device: { destroy(): void } | null = null;
    (async () => {
      try {
        const canvas = ref.current;
        const gpu = (navigator as Navigator & { gpu?: Gpu }).gpu;
        const adapter = await gpu?.requestAdapter();
        // lifetime: OK — destroyed in the effect cleanup, or here when the swatch is already gone
        const dev = await adapter?.requestDevice();
        device = dev ?? null;
        if (!live) return device?.destroy();
        const ctx = canvas?.getContext("webgpu") as unknown as GpuContext | null;
        if (!canvas || !dev || !ctx) return setOk(false);
        ctx.configure({ device: dev, format: "rgba16float", toneMapping: { mode: "extended" }, alphaMode: "opaque" });
        const enc = dev.createCommandEncoder();
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: BOOST, g: BOOST, b: BOOST, a: 1 }, loadOp: "clear", storeOp: "store" }] });
        pass.end();
        dev.queue.submit([enc.finish()]);
        setOk(true);
      } catch {
        // error: SHOWN — english: the dev HDR test's swatch reads "no" (Developer card only, not translated)
        if (live) setOk(false);
      }
    })().catch(logged("the dev HDR test's WebGPU swatch"));
    return () => {
      live = false;
      device?.destroy();
    };
  }, []);
  return (
    <figure className="hdr-swatch">
      <canvas ref={ref} width={64} height={64} />
      <figcaption>B · WebGPU{ok === false ? " ✗" : ""}</figcaption>
    </figure>
  );
}

export default function HdrTest() {
  const { t } = useTranslation();
  const hdr = typeof matchMedia === "function" && matchMedia("(dynamic-range: high)").matches;
  return (
    <div className="hdr-test">
      {/* hint: MUST-SHOW — a live status: whether the display reports HDR, and what to look for */}
      <p className="dk-hint">{t("desktop.dev.hdrHint", { state: hdr ? t("desktop.dev.hdrYes") : t("desktop.dev.hdrNo") })}</p>
      <div className="hdr-swatches">
        <figure className="hdr-swatch">
          <div style={{ background: "#ffffff" /* theme-exempt: the SDR white reference */ }} />
          <figcaption>{t("desktop.dev.hdrReference")}</figcaption>
        </figure>
        <figure className="hdr-swatch">
          <div style={{ background: `color(srgb-linear ${BOOST} ${BOOST} ${BOOST})` }} />
          <figcaption>A · CSS</figcaption>
        </figure>
        <GpuSwatch />
      </div>
    </div>
  );
}
