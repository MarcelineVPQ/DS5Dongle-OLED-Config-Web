# Realistic (PBR) rendering: research and recommended stack

Research date: 2026-10-12. Scope: backlog row "Realistic (PBR) controller and UI materials". Read-only research; nothing here is built yet.
Bundle sizes marked *measured* were measured on 2026-10-12 with esbuild (minified ESM, gzip -9) on a minimal entry that imports only what the feature needs. Library versions are the current npm releases on that date.

## TL;DR

- **Primary choice: three.js (MIT), its `three/webgpu` build (`WebGPURenderer` + TSL node materials), used directly (no react-three-fiber)** inside one lazy-loaded React component, the same pattern as `SwirlField.tsx` / `HdrGlow.tsx`. One framework covers every phase: the 2.5D phase (flat planes with generated normal/height maps under `MeshPhysicalNodeMaterial`), the 3D model (glTF via `GLTFLoader`), post effects (bloom, god rays, SSR, tone mapping, all as TSL nodes in core addons), HDR output (`outputType: HalfFloatType` gives an `rgba16float` canvas with `toneMapping: { mode: "extended" }`, the path `HdrGlow` already uses), and idle path tracing (`three-gpu-pathtracer`, MIT, now WebGPU-first).
- **Cost:** about 215 KB gzip for the WebGPU build (*measured*: `WebGPURenderer` + `MeshPhysicalNodeMaterial`). The WebGL-only build with a physical material and PMREM is about 134 KB gzip, or 151 KB with pmndrs/postprocessing. Load it only when the feature is on. With the feature off the app ships and runs exactly as it does today.
- **Ray tracing:** do it in three tiers. (1) Lighting baked in Blender/Cycles (AO, cavity, the light guide's thickness), which costs nothing at runtime. (2) Cheap screen-space "traced" effects while the scene is live (height-field contact shadows, SSR). (3) A progressive path tracer that runs only when the scene goes idle, stops at a set sample count, denoises once and then holds the image.
- **Lean rules** (the app already follows most of them): render only on change, cap the frame rate for anything ambient, skip all GPU work when the window is hidden or minimized, draw one still frame under Reduce motion, and keep the current flat SVG as the fallback and the accessible source of truth.

## What the app already has (and what carries over)

- `src/desktop/live/SwirlField.tsx`: a WebGL2 swirl background drawn at 1/3 of the window size, about 12 fps (4 fps when the window is unfocused, none when hidden). It has a 128x72 CPU fallback and one still frame under Reduce motion. Its colors come from the colorway or the theme tokens.
- `src/desktop/live/HdrGlow.tsx`: an HDR lightbar glow on a WebGPU `rgba16float` canvas in extended tone mapping. It **rasterizes the SVG's `.led` shapes into a mask** (R = sharp core, G = blurred halo) once per size, the same technique the 2.5D pipeline needs for every part.
- `useWindowShown` / `data-window-hidden`: CSS animations already pause while the window is hidden (fixed on the `win-tray-cpu` branch).
- Gates: `check_theme_colors.mjs` (no literal colors) and the one-theme-system rule. Material albedos, light tints and glow colors must come from the colorway or theme tokens, passed in as uniforms. Physical constants (IOR, roughness) are not colors and can live in a material table.

## 1. Rendering libraries

| Library | License | Minimal bundle (gzip) | PBR features relevant here | Fit |
|---|---|---|---|---|
| **three.js 0.186** (`three/webgpu`) | MIT | **~215 KB** (*measured*) | `MeshPhysicalMaterial`/`MeshPhysicalNodeMaterial`: clearcoat, transmission + thickness/attenuation (volume), sheen, iridescence, anisotropy, dispersion, specular, `emissiveIntensity`. `MeshSSSNodeMaterial` (fast approximate subsurface scattering with thickness color/distortion/power/scale). TSL post nodes in addons: `BloomNode`, `GodraysNode`, `SSRNode`, `SSSNode` (screen-space shadows), `GTAONode`, `LensflareNode`, `TRAANode`, `FXAANode`/`SMAANode`. Tone mapping: ACES, AgX (`AgXToneMapping`), Khronos PBR Neutral (`NeutralToneMapping`). HDR canvas output. Falls back to a WebGL2 backend automatically | **Primary** |
| three.js 0.186 (WebGL `WebGLRenderer`) | MIT | ~134 KB (*measured*; with pmndrs `postprocessing` bloom + god rays + tone mapping: ~151 KB) | Same material set as above. Post effects through pmndrs/postprocessing (Zlib), which works only with `WebGLRenderer` | Fallback option, but it has no HDR canvas path, so it would split the HDR work |
| react-three-fiber 9 + drei 10 | MIT | adds to three | `<Environment>`, `ContactShadows`, `MeshTransmissionMaterial` (costs an extra scene pass per material, two with `backside`), `frameloop="demand"` | **Not now**: r3f 9 needs React 19 (the app is on React 18.3), and r3f 8 is the legacy line. Its main value (declarative scenes, `invalidate()`) is about 30 lines to write ourselves |
| Babylon.js 9.30 | Apache-2.0 | ~433 KB (*measured*: Engine + Scene + PBRMaterial + light) | Strongest built-in subsurface: `PBRMaterial.subSurface` (translucency, thickness map, tint, scattering) | Too big for one drawing, and it would be a second framework next to React's imperative canvases |
| PlayCanvas 2.23 | MIT | ~516 KB (*measured*: Application + one render entity) | Solid PBR, an editor-centric workflow | Too big; built around an app-wide engine loop |
| Filament 1.53 (WASM) | Apache-2.0 | npm unpacked 3.9 MB (WASM) | Reference-quality PBR, built-in bloom, Khronos Neutral | Materials are compiled offline (`matc`), so custom 2.5D shaders are awkward. Large WASM. Web is not its main target |
| OGL 1.0 | Unlicense | ~14 KB (*measured*) | No PBR: you write the shaders | Good for the 2.5D shader alone, but phase 3 would mean a rewrite |
| regl 2.1 | MIT | small | WebGL1-era functional wrapper, no PBR | Same as OGL |
| Raw WebGL2/WebGPU (today's approach) | n/a | 0 | Everything hand-written | Fine for the swirl and the HDR glow. A full PBR stack with PMREM, GGX, clearcoat, SSS and post effects would mean reimplementing three.js |
| `<model-viewer>` 4.4 (Google) | Apache-2.0 | built on three.js | Turnkey glTF viewer: IBL, AR, Neutral tone mapping, IntersectionObserver pausing | Reference for good defaults, but it is a black box (no custom 2.5D materials, no driving it from the live controller state) |

**Electron notes.** Download size matters less in a desktop app, but parse time and memory still matter, so `import()` the renderer only when the feature is enabled. Electron 43 is Chromium-based, and WebGPU already works there for the HDR glow on KDE Wayland (see ADR 0004 on the Linux GPU setup). Pass `powerPreference: "low-power"` (both WebGL and WebGPU accept it) unless the path tracer is running. On dual-GPU laptops this keeps the work on the integrated GPU.

## 2. 2.5D: lighting the existing SVG drawing

How open-source 2D games do it: each sprite carries an albedo map plus a **normal map** (often also height, specular/roughness and emissive maps), and a deferred or forward shader lights it with point or directional lights. Tools and examples:
- Sprite Lamp (commercial) and **Laigter** (GPL-3.0; per its author, the normal maps you make with it are yours to use, including commercially), which generate normals from a sprite's luminance or alpha bevel.
- NormalMap-Online (cpetry; the license is reported as MIT, confirm in the repo), AwesomeBump.
- `pixi-lights` (MIT, PixiJS userland): deferred normal-map lighting. Maintainers call it experimental.
- Unity TextMeshPro computes a **bevel normal from a signed distance field**, which is exactly the "height from shapes" trick we need. It warns that strong bevels show artifacts.

**Recommended 2.5D pipeline (all generated at runtime from the SVG, no hand-painted maps):**
1. **Part masks.** Rasterize the controller SVG into a small atlas once per size and colorway change, the way `HdrGlow.buildMask` does now. Channels: material ID (shell, face buttons, sticks, touchpad, grips, light guide, PS button), plus a coverage mask.
2. **Height from shapes.** Compute a distance field per part, either with the jump-flood algorithm (a few GPU passes at about 1K) or on the CPU at a lower resolution, then map distance to a bevel profile per material (a rounded shoulder for the shell edge, a dome for the face buttons, a concave dish for the stick tops). Normal = gradient of height (Sobel), computed once.
3. **Detail normals.** Add tiling micro-normals per material: a procedural noise speckle for the shell's micro-texture, a fine grain for the touchpad, ribs for the grips (a 1D sine across a mask), knurling for the sticks (a crossed or diamond pattern), and an embossed height for the etched face-button symbols (from the symbol paths). Blend them over the macro normal with a "whiteout"/UDN blend. These can be TSL functions (no textures to ship) or small baked tiles later.
4. **Shade.** Render one orthographic plane (or one per layer) with `MeshPhysicalNodeMaterial`. Albedo comes from colorway or theme uniforms looked up by material ID (one theme system). Roughness and clearcoat come from a per-material table: matte shell around 0.55, glossy buttons with clearcoat, soft-touch grips at high roughness plus a little sheen, the light guide using transmission/thickness or `MeshSSSNodeMaterial`. The "sun" is a `DirectionalLight` whose direction follows a draggable handle or the pointer. GGX specular plus clearcoat give real glints that move with the sun.
5. **Light guide and LEDs.** Emissive above 1.0 in HDR, plus the SSS node material for the "glows from inside" look. For bleed into the surrounding shell, blur the emissive mask (the existing halo channel) and add it into the shell's lighting. A more physical 2D option is **radiance cascades** (a 2D global-illumination technique with open web implementations) to light the shell from the lightbar's emissive pixels. Worth a prototype, but it is optional.
6. **Self-shadowing.** March the sun direction across the height field (8 to 16 taps) for contact shadows under the sticks and buttons. This is the cheap 2.5D form of ray-traced shadows.
7. **Accessibility.** The SVG stays in the DOM for hit-testing, focus rings, labels and live highlights. The canvas sits underneath it as decoration (`aria-hidden`), as `HdrGlow` does today.

**UI materials (cards, glass, edges).** Don't render the DOM UI in WebGL. Expose the same sun direction as CSS custom properties (for example `--sun-x`, `--sun-y`, updated only when the sun moves) and let the themes use them in border and highlight gradients (a conic-gradient border sheen, a moving highlight on glass). "Glints sweeping across edges" then costs one style update per sun move and nothing per frame. The colors still come from tokens, so the theme gate keeps passing.

## 3. Asset and material pipeline (phase 3: a real 3D model)

- **Format:** glTF 2.0 (GLB). Ratified extensions three.js's `GLTFLoader` reads: `KHR_materials_clearcoat`, `transmission`, `volume`, `ior`, `specular`, `sheen`, `iridescence`, `anisotropy`, `dispersion`, `emissive_strength`, `unlit`, `variants`, plus `KHR_texture_basisu`, `KHR_texture_transform`, `KHR_mesh_quantization` and `EXT_meshopt_compression`. It also reads `KHR_materials_diffuse_roughness` and `EXT_materials_bump`.
- **`KHR_materials_diffuse_transmission`** (the "SSS-like" thin translucency) is still a **Release Candidate**, not ratified, and three.js's `GLTFLoader` doesn't read it as of 0.186. Plan: author the light guide as `transmission` + `volume` (thickness, attenuation color) in glTF, then swap in `MeshSSSNodeMaterial` at load time by material name.
- **`KHR_materials_variants`** fits colorways, but our colorways are uniforms from the theme system, so variants aren't needed.
- **Modeling and baking: Blender** (GPL. The license covers the program, not your models or renders). Model from our own measurements and photos. The TurboSquid DualSense Edge model is Editorial Uses Only and is a visual reference only. Bake AO, cavity/curvature and thickness maps in Cycles (see §7). Export with the Khronos glTF exporter, which supports most ratified material extensions (check the exact list for the Blender version).
- **Optimization:** glTF-Transform (MIT): meshopt geometry, prune and dedupe, resize textures, KTX2 output. Use KTX2/Basis Universal (KTX-Software and the Basis transcoder are Apache-2.0): ETC1S for albedo and the ORM pack, UASTC for normal maps. The aim here is lower VRAM and faster upload, not download size. The Basis transcoder is a WASM file to bundle, so this is only worth it once we have a few 2K textures.
- **Calibration against our own photos** (Marcy's controllers, never Sony or store photos):
  - The Khronos 3D Commerce *Real-time Asset Creation Guidelines* (CC BY 4.0) cover PBR value ranges. A common rule: keep albedo between about 30-50 and 240 in sRGB.
  - Albedo from evenly lit shots with a grey card or ColorChecker for white balance and exposure.
  - **Cross-polarized photography** (polarizing film on the light, a circular polarizer on the lens rotated 90°) removes speculars, which gives clean albedo. A parallel-polarized shot minus the cross-polarized one isolates the specular, for judging roughness from highlight size and sharpness.
  - Dark-room shots of the lightbar for the subsurface bleed.
  - Validate with a side-by-side: the same camera angle, our render under an environment that matches the photo's lighting (a CC0 HDRI from Poly Haven, or one we shoot ourselves), with Khronos PBR Neutral tone mapping so hues aren't shifted.
  - The Khronos glTF Sample Viewer (Apache-2.0) and the glTF Render Fidelity comparison are the reference for checking that our model looks right in a spec-correct renderer.
- **Photogrammetry** (Meshroom/AliceVision, MPL-2.0): a poor fit. Glossy and black plastic needs scanning spray, and the result still needs retopology. Hand modeling from calipers and photos is faster and cleaner for a hard-surface product. Photogrammetry is only useful for capturing a detail texture (for example the grip pattern) as a height map.

## 4. Environment lighting from the dynamic background

- **PMREM** (`PMREMGenerator.fromEquirectangular` / `fromScene`) prefilters an environment into roughness levels. The docs recommend about 1024x512 input. Regenerating it every frame is the known performance trap (three.js forum: "bad performances when animating a PMREMGenerator environment"). It is fine for **occasional** changes: game art switching, or a colorway change.
- **Background swirl (it changes continuously):** don't run PMREM per frame. Cheaper options, cheapest first:
  1. **A mip chain of the small background texture as a fake environment.** The swirl is already drawn at 1/3 size. Downsample it to about 128x64 with mipmaps and sample `textureLod(env, dir, roughness * maxLod)`. This costs almost nothing and looks like it belongs, which is the goal. It isn't physically accurate, because a front-facing object reflects what is in front of it, not the background behind it.
  2. **Spherical harmonics (L2, 9 coefficients) for diffuse light.** Compute them on the CPU from the 128x72 swirl (the CPU fallback's `swirlPixel` math already exists) or from a 32x16 readback. Update them at the swirl's ~12 fps, or slower: diffuse light from slow swirls barely changes. three.js's `LightProbe`/`LightProbeGenerator` takes them.
  3. **PMREM only when the background "settles"** (art changed, or once a second while swirling), and cross-fade between the old and new environment.
- **Share the GPU context:** port the swirl shader into the same three.js renderer as a render target. That avoids copying from a second canvas each frame. Short term, a `CanvasTexture` of the swirl canvas works (a GPU-to-GPU copy at 1/3 size).
- **Blurred game art** is a still image: build the PMREM once per art change.

## 5. Ray and path tracing

**Hardware ray tracing:** WebGPU has no shipped ray-tracing or ray-query extension. Everything on the web runs on compute or fragment shaders over a BVH: three-mesh-bvh (MIT) and WebRTX (compute-shader based) are examples. Don't plan around hardware RT.

**three-gpu-pathtracer** (gkjohnson, MIT; v0.0.27, updated 2026-10-08, needs three >= 0.185):
- It is now **WebGPU-first**. The README says "the project requires WebGPU". `WebGLPathTracer` still ships but logs a deprecation warning. The WebGPU path has wavefront and megakernel backends.
- glTF-compliant material model: clearcoat, sheen, iridescence, transmission, specular and diffuse lobes. It supports MeshStandard and MeshPhysical materials, area, spot, point and directional lights with multiple importance sampling (MIS), and emissive surfaces without MIS (relevant for the lightbar, which will converge slowly as a light source).
- Convergence control: `maxSamples` stops accumulating once every pixel reaches N samples (the default 0 means forever). `pause` keeps showing the last image. Stats report `samplesPerSecond`. Blue-noise and Sobol sampling make early frames read as fine grain. `BlurredEnvMapGenerator` pre-blurs the environment to converge faster.
- **Denoising:** a built-in `OIDNDenoiser` wraps **oidn-web** (MIT, Open Image Denoise's network on WebGPU). It **runs once, after accumulation stops**, with small and large weight variants. There is also an `FSRUpscaler` (it doesn't work with a transparent background). No published per-frame timings were found, so benchmark on our hardware.
- Mode switching, the standard pattern: show the fast rasterized frame while input or animation is active. After about 300 ms idle, start accumulating. The old WebGL API had `renderDelay`, `minSamples` and `fadeDuration` to blend from raster to traced. Stop at a sample cap (for example 256-512 for a mostly diffuse and clearcoat product shot), denoise once, show that image until something changes, then reset.
- **Power and heat:** a path tracer runs the GPU at 100% while it accumulates. "Render until converged, then stop" is mandatory: each idle period is bounded (a few seconds of full GPU on a laptop iGPU, then nothing). Never run it under Reduce motion, on battery (Electron `powerMonitor.onBatteryPower`), with hardware acceleration off, or while hidden. Trace at a capped resolution (the controller's bounding box, not the window) and upscale. Keep it behind an explicit "High quality (ray traced)" setting.
- **Which phase:** it needs real geometry (BVH over triangles). It adds nothing to the 2.5D planes, so it belongs in phase 4 with the 3D model.

**Cheaper "ray-traced look":**
- **Baked lighting (cheapest, and the most bang for the buck).** Bake AO, cavity, bent normals and the light guide's thickness in Blender/Cycles, which is a real path tracer. Multiply the AO into the indirect light at runtime. For 2.5D, bake those maps on the 3D model and project them into the SVG's frame, or approximate AO from the generated height field.
- **Screen-space traced effects while live:** height-field contact shadows (§2.6), `SSRNode` for clearcoat reflections, `GTAONode`, and `SSSNode` screen-space shadows for the 3D model.
- **2D GI (radiance cascades)** for the lightbar lighting the shell in 2.5D (§2.5).

## 6. Examples and lessons from open-source viewers

- **`<model-viewer>`** (Apache-2.0, built on three.js) pauses rendering through IntersectionObserver when off screen to save battery and GPU, uses a static poster image as the fallback, and uses Khronos Neutral tone mapping for product color accuracy.
- **Babylon Viewer v2** suspends the render loop when nothing changes, for battery. The maintainers warn that the hard part is waking it reliably on every kind of change. Lesson: every state change must go through one `invalidate()` function.
- **Khronos glTF Sample Viewer** (Apache-2.0) and **glTF Render Fidelity** are the reference for correct extension rendering and cross-engine comparisons.
- **drei `MeshTransmissionMaterial`**: each transmissive material adds a full scene pass (two with `backside`). For rough materials a 32x32 buffer is enough. For us the light guide uses SSS instead, with no extra pass.
- **pmndrs/postprocessing** (Zlib) merges effects into as few fullscreen passes as possible. three's TSL post nodes do the same by composing node graphs into one pass where they can.
- **Tone mapping:** Khronos **PBR Neutral** for product shots (it keeps hue and saturation and only compresses highlights), AgX for an unstylized but flatter look, ACES for more contrast with a darker, hue-shifted result. Recommended: Neutral for the controller. Colorway accuracy matters most.

## 7. Accessibility and performance patterns

- **Frame on demand:** one `invalidate()` per change (colorway, input highlight, sun drag, resize, environment update). It requests a single `requestAnimationFrame`, renders, and stops. This is r3f's `frameloop="demand"` rewritten in about 30 lines.
- **Ambient motion** (dust motes, sweeping glints) is the only continuous loop. Cap it at about 12 fps like the swirl, 4 fps when unfocused, none when hidden, and never under Reduce motion (`prefers-reduced-motion` or the app's `data-reduce-motion`).
- **Hidden or minimized:** skip all GPU work, cancel the rAF, pause the path tracer. On WebGL context loss or GPU device loss, fall back to the flat SVG and retry once (SwirlField already does this).
- **Settings tiers** (App settings -> Advanced): Off (flat SVG, today) / Lit (2.5D PBR, on demand) / Lit + effects (god rays, dust, bloom) / Ray traced when idle (phase 4). With hardware acceleration off: Off only. Optionally one baked CPU image (a still render) as a static poster.
- **Power:** `powerPreference: "low-power"` except while path tracing. Render the controller canvas at the controller's size, not the window's. Use half resolution for god rays and bloom.
- **Accessibility:** the SVG keeps all semantics, focus and labels. The canvas is `aria-hidden`. Contrast and focus indicators never depend on lighting. Lighting must not lower the contrast of the live input highlights: draw the highlights in the SVG layer above the canvas.

## Recommended phased plan

Each phase ships behind an Advanced setting on the Development channel. Each one is skippable and leaves the flat SVG intact.

**Phase 0: plumbing (small)**
- Lazy `import("three/webgpu")` in one `ControllerRender` component (WebGPU first, WebGL2 backend automatically, flat SVG on failure).
- One `invalidate()` scheduler shared with the swirl's visibility and focus logic.
- Move `HdrGlow`'s mask rasterizer into a shared "SVG to atlas" helper.
- A Dev page benchmark: ms per frame, GPU time where available, CPU while idle (it must match today's ~0.5% minimized).

**Phase 1: 2.5D PBR controller**
- Material-ID atlas, distance-field height, normals, procedural detail normals.
- `MeshPhysicalNodeMaterial` per material ID with colorway uniforms, a sun `DirectionalLight` with a drag handle, Khronos Neutral tone mapping.
- Environment = mip-chained swirl or art, plus SH diffuse.
- Height-field contact shadows.
- HDR: emissive above 1.0 on the light guide and LEDs through the same renderer. `HdrGlow` folds into it, so there is one HDR path.
- Exit criteria: idle cost is zero, and it renders correctly in every theme with no literal colors.

**Phase 2: effects and UI materials**
- Bloom (`BloomNode`, HDR-aware) and a screen-space radial-blur god-ray pass from the sun through the controller silhouette mask. Use the classic GPU Gems 3 occlusion-mask technique; `GodraysNode` is raymarched and needs depth and shadows, so it is better saved for 3D.
- Dust motes: a few hundred instanced points, lit only inside the ray mask, ~12 fps, off under Reduce motion.
- CSS sun variables for edge and glass glints in the themes.
- Lightbar SSS bleed (blurred emissive, optionally a radiance-cascades prototype).

**Phase 3: our own 3D model**
- Blender model from measurements and Marcy's photos. Bake AO, cavity and thickness in Cycles (the cheap ray-traced look).
- glTF with clearcoat, volume and transmission, optimized with glTF-Transform and KTX2.
- Same materials, environment, sun and post effects as phase 1 (planes swapped for meshes). Calibrate side by side against photos.
- Drawing-matched views: front, plus optional tilt on hover.
- The live highlights must stay aligned with the SVG overlay, or move into 3D with their own accessible hit targets.

**Phase 4: ray traced when idle**
- three-gpu-pathtracer (WebGPU) on the phase 3 scene: rasterized while active, traced after ~300 ms idle, `maxSamples` cap, one OIDN denoise, then hold.
- Off on battery, under Reduce motion and when hidden. An explicit setting.
- Benchmark time to converge on the RTX 5080 and on a laptop iGPU (the Windows VM is not representative of GPU cost).

## License notes (everything is compatible with an MIT app)

| Component | License | Notes |
|---|---|---|
| three.js, three-mesh-bvh, three-gpu-pathtracer, oidn-web, glTF-Transform, r3f/drei | MIT | Keep the copyright notices in the app's third-party licenses list |
| pmndrs/postprocessing | Zlib | Permissive, no attribution required in binaries |
| OGL | Unlicense | Public-domain style |
| Babylon.js, Filament, `<model-viewer>`, KTX-Software, Basis Universal, Khronos glTF Sample Viewer | Apache-2.0 | Compatible. Include the license text and any NOTICE file if we bundle them |
| OIDN weights (oidn-weights) | Apache-2.0 (OIDN's own license) | Check the weights repo before bundling them |
| Laigter | GPL-3.0 | Tool only, never vendor its code. Per the author, its output maps are free to use |
| Blender | GPL | Tool only. Models, bakes and renders are ours |
| Meshroom/AliceVision | MPL-2.0 | Tool only |
| Khronos 3DC asset guidelines | CC BY 4.0 | A document; cite it if we quote it |
| Poly Haven HDRIs | CC0 | Fine for calibration and static environments |
| three-good-godrays | not stated on npm | Check the repo before use (probably not needed) |

## Open questions

1. **2.5D look direction:** is the SVG drawing's perspective (straight-on, orthographic) final? A tilt or parallax look requires phase 3.
2. **WebGPU-only for the lit modes?** The HDR glow is already WebGPU. If WebGPU fails, three's WebGL2 backend still works but loses the HDR canvas. Is an SDR "Lit" mode on WebGL2 acceptable, or should the lit modes simply be off without WebGPU?
3. **macOS and Windows** (best effort): WebGPU HDR behavior differs per OS compositor. Linux/KDE is the verified path. Flag the platform limits in the UI.
4. **Highlight layering in 3D:** in phase 3, do live input highlights stay as a 2D SVG overlay (simple and accessible) or become 3D emissive parts (prettier, but needs separate hit targets and focus handling)?
5. **Path tracer budget:** what sample cap and idle delay feel right? Does ray tracing stay entirely off on battery, or run at a lower cap?
6. **Asset weight:** procedural detail normals (no files) versus baked KTX2 tiles. Prototype procedural first.
7. **Dependency rule** (CLAUDE.md: exact versions, chosen at least 2 weeks after release): three-gpu-pathtracer published 0.0.27 on 2026-10-08 and is pre-1.0 with fast churn (the WebGL API is deprecated). Pin it, and expect API breaks between versions.
8. **Art rule** (CLAUDE.md: never AI-drawn or traced controller art): does a Blender model we build ourselves from our own measurements and photos count as allowed? Probably yes, since it is our own work and not a trace of someone else's art, but confirm before phase 3. The 2.5D phase only reuses the licensed AL2009man SVG.
9. **Measure before committing:** the frame cost of the 2.5D shader at 4K, the cost of a PMREM regeneration at 256x128 on an iGPU, and OIDN denoise time. None of these have trustworthy published numbers.

## Sources

- three.js PMREMGenerator docs: https://threejs.org/docs/pages/PMREMGenerator.html
- three.js LightProbeGenerator docs: https://threejs.org/docs/pages/LightProbeGenerator.html
- PMREM per-frame performance thread: https://discourse.threejs.org/t/bad-performances-when-animating-a-pmremgenerator-environment/48043
- three.js tone mapping overview (forum): https://discourse.threejs.org/t/tone-mapping-overview/75204
- three.js `webgpu_hdr` example PR #31893: https://github.com/mrdoob/three.js/pull/31893 ; three.js HDR thread: https://discourse.threejs.org/t/bringing-hdr-from-webgpu-onto-the-screen/88772
- Chrome WebGPU HDR (canvas tone mapping mode): https://developer.chrome.com/blog/new-in-webgpu-129
- three.js source checked locally (0.186.1): `examples/jsm/tsl/display/*` (GodraysNode, BloomNode, SSRNode, SSSNode, GTAONode), `src/materials/nodes/MeshSSSNodeMaterial.js`, `src/renderers/webgpu/WebGPUBackend.js` (`outputType: HalfFloatType` gives `toneMapping: 'extended'`), `examples/jsm/loaders/GLTFLoader.js` (extension list)
- glTF extension registry (ratification status): https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md
- glTF-Transform KHR_materials_diffuse_transmission: https://gltf-transform.dev/modules/extensions/classes/KHRMaterialsDiffuseTransmission
- luma.gl glTF materials (diffuse transmission as release candidate): https://luma.gl/docs/api-reference/gltf/gltf-materials
- glTF Render Fidelity: https://github.khronos.org/glTF-Render-Fidelity/compare/TransmissionTest
- Khronos PBR Neutral in Blender: https://projects.blender.org/blender/blender/pulls/118936
- Khronos 3D Commerce Real-time Asset Creation Guidelines: https://www.khronos.org/blog/3d-commerce-working-group-releases-real-time-asset-creation-guidelines-to-assist-artists-create-efficient-reliable-models-for-retail-and-e-commerce ; registry: https://registry.khronos.org/3DCommerce/AssetCreation
- KTX: https://khronos.org/ktx/
- r3f scaling performance (frameloop demand): https://r3f.docs.pmnd.rs/advanced/scaling-performance
- drei MeshTransmissionMaterial: https://drei.docs.pmnd.rs/shaders/mesh-transmission-material ; cost thread: https://discourse.threejs.org/t/meshtransmissionmaterial-poor-performances-urgent/68566
- react-postprocessing god rays: https://react-postprocessing.docs.pmnd.rs/effects/god-rays ; pmndrs/postprocessing (Zlib): https://www.jsdelivr.com/package/npm/postprocessing
- model-viewer: https://web.dev/articles/model-viewer
- Babylon Viewer v2 (render-loop suspension): https://babylonjs.medium.com/babylon-viewer-v2-e3e05674f110
- Babylon subsurface (forum): https://forum.babylonjs.com/t/pbr-subsurface-parameters-question/40738
- Filament on npm: https://www.npmjs.com/package/filament
- three-gpu-pathtracer: https://github.com/gkjohnson/three-gpu-pathtracer (package 0.0.27 inspected locally: `src/webgpu/WebGPUPathTracer.js`, `denoise/OIDNDenoiser.js`, `upscale/FSRUpscaler.js`, deprecation in `src/core/WebGLPathTracer.js`)
- OIDN-Web with three.js WebGPU (integration notes): https://gitcode.csdn.net/6a2d6ff210ee7a33f27c7afc.html
- WebRTX (compute-shader ray tracing on WebGPU): https://github.com/codedhead/webrtx
- What's next for WebGPU (Chrome): https://developer.chrome.com/blog/next-for-webgpu
- Laigter (GPL-3.0): https://azagaya.itch.io/laigter ; open-source announcement: https://azagaya.itch.io/laigter/devlog/89223/laigter-is-now-open-source
- NormalMap-Online: https://alternativeto.net/software/normalmap-online/about
- pixi-lights: https://www.npmjs.com/package/pixi-lights
- TextMeshPro SDF bevel: https://docs.unity3d.com/Packages/com.unity.textmeshpro@3.2/manual/ShadersDistanceField.html
- Jump flooding: https://terohannula.itch.io/jump-flooding-algorithm ; RTSDF paper: https://arxiv.org/pdf/2210.04449
- Meshroom licenses: https://meshroom-manual.readthedocs.io/en/latest/about/licenses/licenses.html
- PBR albedo ranges (secondary): https://docs.cocos.com/creator/manual/en/shader/effect-builtin-pbr.html
- npm registry metadata (versions, licenses, peer deps) queried 2026-10-12 for three, postprocessing, @react-three/fiber, @react-three/drei, @babylonjs/core, playcanvas, filament, ogl, regl, @google/model-viewer, @gltf-transform/core, three-gpu-pathtracer, oidn-web
