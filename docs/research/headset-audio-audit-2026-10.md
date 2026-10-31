## Headset audio audit: is the headset path the best it can be? (read-only)

**Question (owner, 2026-10-13):** for a large user base (a million users) with a headset in the controller, is the headset audio as good as it can be?

**Answer: not yet.** The Bluetooth codec side is in good shape: full-band stereo CELT at the largest frame the 0x39 report holds, with no drops on the owner's board. Most of what a headset user hears wrong happens before the encoder. On Linux the default card profile sends mono to the right channel only. The hardware volumes restored at boot leave the microphone gain at 0 and cap the headphone amp. The speaker resampler is plain linear interpolation. On top of that, the microphone jitter buffer has no level control.

**How this was measured.** On the owner's machine, read-only: `pactl list cards`, `pw-dump`, `amixer cget`, `/var/lib/alsa/asound.state`, and one passive GET each of `0xF5`, `0xFC`, `0xFD` and `0xFE` over hidraw. No setting, profile or volume was changed, and nothing was played or recorded. The rest comes from the firmware source (`~/projects/DS5Dongle`, master 3c611b1) and an offline simulation of the resampler. Hardware-only questions are in the owner test plan at the end.

### Top findings

1. **Linux default profile: right ear only (high impact).** The default profile is `HiFi (Mic, Speaker)`, and WirePlumber kept it even though the headset jack reads plugged in (`Headphone Jack` = on). Its sink is 1 channel and is wired to hardware channel 1 only (`api.alsa.split.position = [AUX1]` of `[AUX0..AUX3]`; UCM `Channel0 1`). The firmware encodes ch1/ch2 as stereo Opus (`audio.cpp:510-511`). With a headset in, `speaker_select` Auto tags the block `0x16` "Headset" (`audio.cpp:127-131`). So the headset gets silence on the left and the game on the right. A real DualSense on the default profile behaves the same way: the kernel routes the right channel to the mono speaker. The owner should confirm by ear (T1).
2. **The microphone gain is 0 at every plug-in on Linux (high impact).** The DualSense UCM devices name no `PlaybackMixerElem` / `CaptureMixerElem`, so PipeWire uses software volume and never touches the hardware controls. Whatever `alsactl` restores stays put. On this machine that is `Headset Capture Volume` = 0 (0 dB of 0..48) and `PCM Playback Volume` = 80 (−20 dB). The firmware turns those into `VolumeMic` = 0 (`usb.cpp:97-99`, 0..48 dB → 0..0x40) and an amp volume of 80. `BLUETOOTH_AUDIO_NOTES.md` already says captures "look silent" until this control is raised.
3. **The headphone amp can never reach full volume (medium impact, one line).** `state_set_volume(v, v)` (`usb.cpp:90-91`) sends the same 0..100 value to both amps. The headphone amp goes to 0x7F (127), so 0 dB on the PC gives 100/127 (79 %). On this machine it is 80/127 (63 %).
4. **The speaker resampler is linear interpolation with no filter.** `SetMode(true, 0, false)` (`audio.cpp:713`) turns 512 frames into 480 frames every 10.67 ms. The controller plays them at an effective 45 kHz. A simulation of that step gives these levels and worst spurs (dBc = relative to the tone's own level):

   | Tone | Level change | Worst spur |
   | --- | --- | --- |
   | 5 kHz | −0.6 dB | −37 dBc |
   | 10 kHz | −2.4 dB | −22 dBc |
   | 15 kHz | −3.6 dB | −14 dBc |
   | 20 kHz | −5.3 dB | −6 dBc |

   The codec is good enough to pass these errors on: 150 kbit/s CELT, near transparent. That makes the resampler the largest loss of quality the dongle adds on the way to the headset.
5. **The microphone path has the most latency, and it can grow.** It pre-buffers 3 frames (30 ms) and has no level control. A burst over Bluetooth, or the controller's clock running faster than the PC's, raises the level toward the cap of 8 frames (80 ms), and it never comes back down. Concealment on the owner's board was 59 of 943 frames (6.3 %) since boot, about 33 of them the known burst right after connecting. Core1 now has measured timings: a speaker frame takes 4.58 ms on average and 5.44 ms at worst, out of 10.67 ms. A microphone frame takes 1.61 ms on average and 4.75 ms at worst. With a headset chat both run, which leaves about 4.5 ms of headroom on average and almost none at worst.

### Current state

| Stage | Value | Source |
| --- | --- | --- |
| USB audio OUT (PC → board) | UAC1, 4 ch (FL FR RL RR), S16_LE, 48 kHz, adaptive; ch1/2 speaker or headset, ch3/4 haptics | `/proc/asound/card6/stream0`; `tusb_config.h:112-124` |
| USB audio IN (board → PC) | UAC1, 2 ch, S16_LE, 48 kHz, async; mono microphone copied to L and R | `audio.cpp:273-277` |
| Linux profiles | `HiFi (Mic, Speaker)` = 1-ch sink → hw ch1 (FR) + 1-ch source ← hw ch0; `HiFi (Headphones, …)` = 2-ch sink → ch0/ch1. Speaker and Headphones are ConflictingDevice, so they sit in separate profiles. All 4 HiFi profiles have priority 8200 | UCM `Sony/DualSense-PS5-HiFi.conf`; `pactl list cards` |
| Linux jack | `Headphone Jack`, `Headset Mic Jack` kcontrols exist and read **on**; the Headphones port shows `available`; the active profile is still `HiFi (Mic, Speaker)`; `api.acp.auto-profile = false` (WirePlumber picks profiles, and only when the card appears) | `amixer -c 6`; `pactl` |
| Linux hardware volume | Speaker/headphone 80 (−20 dB), microphone 0 (0 dB of 48), from `asound.state`; PipeWire never writes them (no MixerElem in UCM) | `asound.state`; UCM |
| PipeWire | quantum 1024 (21.3 ms), min 32; playback period 256 × 128, headroom 256; capture period 512, headroom 512 | `pw-metadata -n settings`; `pw-dump` |
| TinyUSB buffers | OUT software FIFO 16 × 392 B = 6272 B (16.3 ms); IN 4 × 196 B = 784 B (~4 ms) | `tusb_config.h:125-131` |
| Speaker chunk | 512 frames (10.67 ms) of ch1/2 → `audio_fifo` (depth 2, drop oldest) | `audio.cpp:509-524, 591` |
| Resampler | WDL, linear interpolation, no filter, 51200→48000 rates (= 512→480) | `audio.cpp:713-716` |
| Encoder | libopus 1.6 float, `RESTRICTED_CELT`, 48 kHz stereo, 10 ms, 160 kbit/s set, CBR, complexity 0; TOC 0xF4 (CELT FB 10 ms stereo), 200 B | `audio.cpp:699-712`; firmware CLAUDE.md |
| Real bitrate | 200 B per 10.67 ms = **150 kbit/s**; effective sample rate 45 kHz (480 samples per 10.67 ms, paired with the 3 kHz haptic frame) | derived |
| BT report | 0x39, 547 B (+1), 2 haptic frames (2×64 B) + 2 speaker frames (2×200 B), one per 21.33 ms (46.9/s); sent as soon as 2+2 frames are queued (not paced) | `audio.cpp:285-360` |
| Bitrate ceiling | The speaker block is 2 × 200 B at offset 142 (ends at 542 of 547). A bigger frame needs a bigger report, and the controller's report size is fixed. **Bitrate is capped by the report layout, not by core1.** | `audio.cpp:36, 140-142` |
| Output tag | 0x13 speaker, 0x16 headset (Auto picks the headset when one is plugged in); 0x14 "L Headset Mono" and 0x15 "L Headset R Speaker" are known but unused | `audio.cpp:124-131, 343-347` |
| Microphone over BT | 71 B Opus per 10 ms (56.8 kbit/s), mono, decoded to 48 kHz; mode (SILK/CELT) unknown: the TOC isn't exposed in any report | `audio.cpp:41-47`; `main.cpp:238` |
| Microphone controls | MicSelect Auto (setting), NoiseCancelEnable on, EchoCancelEnable off, VolumeMic = PC volume 0..48 dB → 0..0x40 | `state_mgr.cpp:37`, `state_override.h:75-79`, `usb.cpp:97-99` |
| Microphone jitter buffer | 8 frames deep, playout starts at 3 (30 ms), conceals after 15 ms without a packet, session ends after 300 ms; drains in 1 ms slices at the PC's clock | `audio.cpp:93-102, 643-678, 246-283` |
| Core1 timings (owner's board, 838 s window) | speaker frame avg 4584 µs / max 5443 µs; microphone frame avg 1609 µs / max 4751 µs; core0 loop avg 40 µs, max 31 ms (BT stage) | `0xFC` read 2026-10-13 |
| Counters since boot (owner's board) | usb_frames 2,863,920 (59.7 s of audio), c1_enc 5593, bt_out 2885, drop raw/enc/hap 0/0/0, mic 943 frames, mic_plc 59, free heap 81 KiB, stage 9 | `0xF5` read 2026-10-13 |
| PS5 | Sony doesn't publish the PS5 → DualSense Bluetooth audio format. The kernel maintainers saw no practical way to support Bluetooth audio ([LKML, hid-playstation jack series](https://lkml.rescloud.iu.edu/2506.1/06542.html)), so Linux has it over USB only. What we know comes from awalol's reverse engineering (the 0x36/0x39 layout, the microphone enable bit). The controller decodes CELT FB 10 ms stereo at 200 B, so we can't tell whether the PS5 sends more. The kernel series confirms the controller plays the right channel on its mono speaker ([Phoronix](https://www.phoronix.com/news/Sony-PS5-DualSense-Audio-Jack)). | cited |

### Latency, per stage (estimates from the buffer sizes above)

**Headset out (PC → ears).**

| Stage | ms | Note |
| --- | --- | --- |
| PipeWire graph + ALSA headroom | ~27 | quantum 1024 + 256 headroom on this machine; ~6 at quantum 256 |
| USB isoc + TinyUSB OUT FIFO | ~1 (max 16) | the FIFO stays near empty: the main loop averages 40 µs and reads 1 ms per pass |
| Fill a 512-frame chunk | 10.7 | |
| Wait for the second frame of the 0x39 pair | 10.7 | the cost of two speaker frames per report |
| Core1 resample + encode | 4.6 (max 5.4) | measured |
| CELT look-ahead | 2.5 | RESTRICTED_CELT |
| Bluetooth airtime + polling | ~3–5 | plus 1.25 ms per retransmission |
| Controller jitter buffer + decode + DAC | unknown, ≥ 10 | `AudioBufferLength` = 64, units unknown (T4) |
| **Total** | **~70 ms** | ~33 ms of it is the board's |

**Headset microphone in (mouth → PC).**

| Stage | ms | Note |
| --- | --- | --- |
| Controller capture + Opus frame + look-ahead | ~12.5–16.5 | mode unknown |
| Bluetooth | ~3 | |
| Core1 decode | 1.6 | measured |
| Jitter buffer | 30 → up to 80 | grows and stays grown (finding 5) |
| USB IN FIFO | ≤ 4 | |
| PipeWire capture (quantum + headroom 512) | ~32 | |
| **Total** | **~85 ms** | up to ~135 ms after the buffer has grown |

For comparison, voice chat feels natural below ~150 ms mouth-to-ear, and wired USB to a real DualSense skips the codec, pairing and jitter-buffer stages: about 40 ms less each way.

### Robustness

- **Counters:** `drop_raw` / `drop_enc` / `drop_hap` (`0xF5` [8..19]) count 10.7 ms chunks lost between stages. They read 0 / 0 / 0 on the owner's board after 60 s of audio, and core1 is resident in RAM and inside its budget. `mic_plc` counts frames concealed by Opus PLC (6.3 % here, about half of that the connect-time burst; the app already warns only when it climbs, row "Pico page: no warning for the connect-time mic concealment").
- **What causes them:** core1 missing its deadline (r), Bluetooth not taking frames fast enough (e/h), Bluetooth loss or bursts (microphone), USB delivery jitter from a hub (June's warble: send is reactive, not paced), a flash save pausing core1 (one 10 ms pop, CHANGELOG).
- **Existing rows:** "Narrator line drops pieces", "Firmware: speaker buffer minimum 28–32 (upstream #252)", the connect-time concealment row (done). This audit adds the rows listed under Fixes.
- **Headroom:** a speaker frame plus a microphone frame at their worst is 10.2 ms against 10.67 ms. Nothing heavier may go on core1 (encoder complexity, a sinc filter) without an A/B on `0xFC` maxima, with the microphone running.

### Linux profile: the app-side fix (design)

**Goal.** The controller's sound follows the headset jack like a laptop's does. Plugging in a headset gives stereo; unplugging gives the speaker back. A choice the player made by hand is never undone.

**Signal.** The `Headphones` port's `available` / `not available` in `pactl list cards` (fed by the kernel's `Headphone Jack` kcontrol, hid-playstation + snd-usb-audio quirk, 6.17+). The `Headset` input port shows whether the headset has a microphone. This works whether or not the app's WebUSB link is open. Older kernels lack the kcontrol: fall back to the input report's headset bit (the app already reads it for the "Headset in" pill).

**Watch.** One `pactl subscribe` child in the main process (lean: no polling), filtering `change` on the DualSense card. The scan in `electron/main/games/system.ts` (`parseDualSenseCards`) gains port availability.

**Act.**

| Event | Active profile | Switch to |
| --- | --- | --- |
| Plug | contains `Speaker` | `HiFi (Headphones, Headset)` when the Headset port is available, else `HiFi (Headphones, Mic)` |
| Unplug | still the profile we set | the profile we switched from |

Never touch `pro-audio` (the Games fix owns it), `off`, or a profile the player picked while plugged in. A manual pick sets "player's choice" until the next unplug. If the DualSense sink was the default output, move the default to the new node (`pactl set-default-sink`): the node name changes with the profile.

**Explain + Undo.** Follows the existing framework.

- The first switch shows "Headphones plugged into the controller: sound switched to stereo" with **Undo**.
- Undo restores the previous profile and offers "Don't switch automatically" for the setting.
- The setting is on by default and lives in App settings → Audio.
- The change history records profile switches. Today the `set-profile` post action of the pro-audio fix writes no backup, so it has no Undo either: add a small profile restore point to `Backups` for both.
- The pro-audio fix's `hifiProfile` (first HiFi profile = always `Mic, Speaker`) uses the same jack-aware chooser.

**Tests.** A parser fixture with the ports block above. A fake `pactl` for plug → switch, manual pick → no switch, unplug → revert. The simulated dongle's headset bit for the fallback path.

**Firmware safety net (independent of the app).** While the output is the headset and ch1 has been silent for ≥ 1 s while ch2 carries sound, copy ch2 into ch1 before encoding. Every Linux user gets both ears even without the app, and the app's stereo switch makes it a no-op. On core0 in `audio_loop`, it costs a compare per sample: no core1 time, no RAM.

**Windows and macOS (from code and OS behaviour; check in T5/T6).** Both see one 4-channel device (FL FR RL RR) with no profiles. A stereo app writes FL/FR, which the board encodes as stereo, so **the headset gets stereo by default**.

- **Windows risk:** the endpoint is "Quadraphonic". Games that render surround put the rear channels on ch3/4, which are the haptics: buzzing grips, and the rear sounds go missing from the headset. The real DualSense has the same problem. The fix is guide text ("Configure → Stereo" in Sound settings); automating it needs undocumented Windows APIs.
- **Windows microphone level** maps to `VolumeMic` the same way. Its default level for a new device is unknown (T6).
- **The controller's speaker on Windows/macOS** plays the right channel only, so sounds panned hard left are lost (fix 9).

### Microphone quality

- **Codec and rate:** 71 B Opus per 10 ms (56.8 kbit/s), mono, decoded at 48 kHz. The bandwidth (narrowband, wideband or fullband) and the mode are unknown because the TOC isn't exposed: `g_mic_toc` is recorded but no report carries it (fix 8). 57 kbit/s is wideband-to-fullband territory for voice.
- **Which microphone:** MicSelect Auto, so the controller picks the headset's microphone when one is plugged in (Settings → Microphone can force Built-in / Headset). On Linux the `Mic, Speaker` profile's source is still named "Internal Microphone", even though Auto is recording the headset. Only the label is wrong.
- **Processing:** NoiseCancelEnable on (the controller's own; the speaker needs it, upstream b821623). EchoCancelEnable off: no effect with a headset, but speaker + built-in microphone chat can echo (fix 10). No AGC in the board.
- **Gain:** VolumeMic from the PC's capture volume. Linux leaves it at the restored value: 0 here (finding 2). The firmware's own default before any PC SET is 0x40 (full).

### Sidetone and 3D audio (feasibility only)

- **Sidetone through the board: not viable.** The microphone reaches the board ~45 ms after you speak (frame + Bluetooth + jitter buffer), and the way back to the headset adds ~35 ms plus the controller's buffer. Sidetone feels like an echo above ~20 ms. It would also cost core1 a mix before every encode. Real sidetone has to happen in the controller; no public bit for it is known. A PC-side "hear yourself" (PipeWire loopback) has the same ~150 ms delay. Not recommended.
- **3D audio:** nothing to do in firmware (no core1 headroom, and the headset gets plain stereo anyway). On the PC it works once the stereo profile is active: Windows Sonic / vendor HRTFs on Windows, a PipeWire `filter-chain` spatializer sink (SOFA HRTF) on Linux. A possible later app idea: offer the Linux spatializer sink, in the fix framework with Undo.

### Fixes, ranked by user impact × effort

| # | Gap | Fix | Repo / files | Effort | core1 / RAM risk |
| --- | --- | --- | --- | --- | --- |
| 1 | Linux headset: right ear only | Firmware safety net: copy ch2 into ch1 while the output is the headset and ch1 is silent ≥ 1 s | firmware `src/audio.cpp` `audio_loop` (core0, RAM-resident already) + host test | S | none on core1; a few bytes |
| 2 | Linux headset stays on the mono profile | App: switch the card profile on jack plug/unplug (design above); jack-aware `hifiProfile`; profile restore point for Undo | app `electron/main/games/system.ts`, `games.ts` (or a new `audio/profileWatch.ts`), Backups, settings, 7 locales | M | none |
| 3 | Microphone gain 0 / amp 80 restored at boot (Linux) | App check + fix "Controller's hardware volume and microphone gain are low": sets `PCM Playback Volume` 100 and `Headset Capture Volume` 101 with `amixer -c <card>`, keeps the old values for Undo; the desktop sliders keep working (software volume). Longer term: send alsa-ucm-conf a `PlaybackMixerElem`/`CaptureMixerElem` for the DualSense | app `electron/main/games/system.ts` + fix framework | S | none |
| 4 | Headphone amp capped at 100/127 | Map the headphone value to 0..0x7F (`v * 127 / 100`); speaker stays 0..0x64 | firmware `src/usb.cpp:90-91` | XS | none |
| 5 | Linear resampler (−2.4 dB and −22 dBc spurs at 10 kHz) | WDL sinc (16–32 taps; `SetMode(false, 0, true, 16, 16)`) or a 2-pole low-pass, A/B by ear + `0xFC` max with the microphone on; the table (~1–4 KB) comes from the heap (81 KiB free) | firmware `src/audio.cpp:713-716`; check the sinc inner loop stays in `.time_critical` (CMakeLists renames) | M | +0.2–0.6 ms per frame (estimate); must stay RAM-resident |
| 6 | Microphone jitter buffer grows and stays grown | Level control: when the level stays above 3 frames for 1 s, drop one frame (or skip 1 ms slices in silence); log it as its own counter | firmware `src/audio.cpp` `mic_drain` (core0) | S–M | none on core1 |
| 7 | 10.7 ms waiting for the second frame of each 0x39 | Try one speaker frame per report (half-size report, or the 0x36 single form) when the headset is the output; doubles the BT report rate (46.9 → 93.75/s) | firmware `src/audio.cpp` `audio_bt_task`, `bt.cpp` | M | none on core1; more BT airtime, needs a range/battery check |
| 8 | Microphone mode unknown | Expose `g_mic_toc` (and the last 0x39 tag) in `0xFD` [44..45] (internal) | firmware `src/cmd.cpp` | XS | none |
| 9 | Speaker plays only the right channel of stereo (Windows/macOS) | When the output is the speaker and ch1 carries sound, send (ch1 + ch2) / 2 on ch2 | firmware `src/audio.cpp` `audio_loop` | S | none |
| 10 | Echo with speaker + built-in microphone | EchoCancelEnable (AudioControl bit 2) on while the output is the speaker and the microphone is in use; test that the speaker stays loud | firmware `src/state_override.h` / `state_mgr.cpp` | S | none |
| 11 | Encoder complexity 0 | A/B complexity 2 and 4 by ear and `0xFC` (PC bench: c4 ≈ +25 % encode time, c10 ≈ +115 %; on the board c10 would not fit) | firmware `src/audio.cpp:712` | S to try | up to +1.2 ms per frame at c4 (estimate) |
| 12 | Windows "Quadraphonic" endpoint (rear channels into the haptics) | Guide: set the controller to Stereo in Sound settings; the Windows VM check shows how it presents | app `docs/GUIDE.md` | XS | none |

Bitrate is not on the list: the 0x39 report has no room for a bigger frame, and at 150 kbit/s CELT stereo the codec isn't the weak link.

### Owner test plan (needs the controller and a headset)

Each step reads `scripts/audio_diag.py 30` and `0xFC` before and after where noted (reset with `0xF6 0x15` first).

| # | What | How | Expect / record |
| --- | --- | --- | --- |
| T1 | Right ear only on the default profile | Headset in, profile `HiFi (Mic, Speaker)`, play a centered mono voice clip at a normal level | Both ears or right only? Then switch to `HiFi (Headphones, Headset)` and play a left/right test: L and R correct? |
| T2 | Microphone level at restored gain | Record 10 s with `Headset Capture Volume` as restored (0), then at 101 (`amixer -c <card> cset name='Headset Capture Volume' 101`; restore it after) | Peak / RMS from `scripts/mic_diag.sh capture`; is 0 silent or only quiet? |
| T3 | Headphone amp cap | After fix 4 on a dev build: same clip at PC 100 %, compare loudness by ear with today's build | Louder, no distortion? |
| T4 | Latency, out and in | Record the headset's left earcup with the PC's own microphone, next to a click played from the PC; measure click → earcup in Audacity. In: tap the headset microphone while recording both it and a PC microphone | ms each way; repeat at quantum 256 (`pw-metadata -n settings 0 clock.force-quantum 256`, set back to 0 after) and at buffer 32 vs 64 |
| T5 | Windows presentation | In the Win11 VM with the board passed through: Sound settings speaker setup (Quadraphonic or Stereo), a stereo test, the default microphone level | Note the defaults; screenshot |
| T6 | Mic chat end to end | Discord/Steam voice test call, 2 min, headset microphone | `mic_plc` per minute, the buffer level (after fix 6), how it sounds |
| T7 | Resampler A/B | Sweep 20 Hz–20 kHz and a hi-hat-heavy track, today's build vs fix 5 (sinc 16) | Highs cleaner? `0xFC` speaker max with the microphone on stays < 8 ms |
| T8 | Complexity A/B | c0 / c2 / c4, same track | Hear a difference? `0xFC` maxima |
| T9 | One frame per report | Prototype of fix 7: latency (T4) and range (walk away until it drops) | ms saved, drop distance, battery over 30 min |

### Sources

- Firmware: `src/audio.cpp`, `src/usb.cpp`, `src/state_mgr.cpp`, `src/state_override.h`, `src/tusb_config.h`, `src/main.cpp`, `BLUETOOTH_AUDIO_NOTES.md`, `CLAUDE.md` (master 3c611b1).
- System: `/usr/share/alsa/ucm2/USB-Audio/Sony/DualSense-PS5-HiFi.conf`, `common/pcm/split.conf`; PipeWire 1.6.2, WirePlumber 0.5.13, kernel 7.0.0-38.
- [LKML: HID: playstation: Support DualSense audio jack hotplug detection](https://lkml.rescloud.iu.edu/2506.1/06542.html) (Bluetooth audio unsupported; right channel → speaker); [Phoronix: DualSense audio jack handling](https://www.phoronix.com/news/Sony-PS5-DualSense-Audio-Jack); [SensePost: DualSense reverse engineering](https://sensepost.com/blog/2020/dualsense-reverse-engineering/).
