import { describe, expect, it } from "vitest";
import { classifyGpu, isSoftwareRenderer, swirlMode } from "../../src/desktop/live/swirlGpu";

// Renderer strings as WebGL reports them (ANGLE wraps most of them).
const SOFTWARE = [
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", // Chromium's fallback, every OS
  "Google SwiftShader",
  "ANGLE (Mesa, llvmpipe (LLVM 17.0.6, 256 bits), OpenGL 4.5)", // Linux without a GPU driver
  "llvmpipe (LLVM 15.0.7, 256 bits)",
  "ANGLE (Mesa, lavapipe (LLVM 17.0.6, 256 bits), Vulkan 1.3)",
  "softpipe",
  "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)", // Windows WARP (VMs, no driver)
  "Apple Software Renderer", // macOS
  "ANGLE (Unknown, Software Adapter, D3D11)",
];
const HARDWARE = [
  "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 5080/PCIe/SSE2, OpenGL 4.5.0)",
  "ANGLE (AMD, AMD Radeon RX 7800 XT (radeonsi, navi32, LLVM 17.0.6, DRM 3.57), OpenGL 4.6)", // LLVM in the name, still a GPU
  "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
  "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
  "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)",
];

describe("swirl GPU detection", () => {
  it("names software renderers on Linux, Windows and macOS", () => {
    for (const r of SOFTWARE) expect(isSoftwareRenderer(r), r).toBe(true);
  });
  it("leaves real graphics cards alone", () => {
    for (const r of HARDWARE) expect(isSoftwareRenderer(r), r).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer("")).toBe(false);
  });
  it("classifies the probe: no WebGL2, software by caveat or by name, hardware", () => {
    expect(classifyGpu({ webgl2: false, fast: false, renderer: null })).toBe("none");
    // Chromium refused the failIfMajorPerformanceCaveat context: software, whatever the name.
    expect(classifyGpu({ webgl2: true, fast: false, renderer: "Some New GPU" })).toBe("software");
    expect(classifyGpu({ webgl2: true, fast: false, renderer: null })).toBe("software");
    // The caveat context worked but the name says software (llvmpipe through the system GL).
    expect(classifyGpu({ webgl2: true, fast: true, renderer: SOFTWARE[2] })).toBe("software");
    expect(classifyGpu({ webgl2: true, fast: true, renderer: HARDWARE[0] })).toBe("hardware");
    // Renderer string hidden: trust the caveat check.
    expect(classifyGpu({ webgl2: true, fast: true, renderer: null })).toBe("hardware");
  });
  it("animates only the shader on a real card; everything else is a still frame", () => {
    expect(swirlMode({ hardwareAcceleration: true, gpu: "hardware" })).toBe("gpu");
    expect(swirlMode({ hardwareAcceleration: true, gpu: "software" })).toBe("cpu");
    expect(swirlMode({ hardwareAcceleration: true, gpu: "none" })).toBe("cpu");
    expect(swirlMode({ hardwareAcceleration: false, gpu: "hardware" })).toBe("cpu");
    // The budget gate's override keeps the shader on SwiftShader, never without WebGL2 or acceleration.
    expect(swirlMode({ hardwareAcceleration: true, gpu: "software", forceGpu: true })).toBe("gpu");
    expect(swirlMode({ hardwareAcceleration: true, gpu: "none", forceGpu: true })).toBe("cpu");
    expect(swirlMode({ hardwareAcceleration: false, gpu: "software", forceGpu: true })).toBe("cpu");
  });
});
