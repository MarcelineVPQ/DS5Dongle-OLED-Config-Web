# Clock and upstream: why the OLED Edition runs at 320 MHz, and how to follow awalol

**Status (2026-10-13):** done; the plan's end state (Stage E) shipped in 0.9.5-dev.8: the Pico 2 W runs at stock 150 MHz and 1.10 V with the embedded XIP flash setup, core0's hot path runs from RAM, and CI builds with ARM 14.2.Rel1 (`-DDS5_CLOCK_KHZ=320000` stays as a one-release fallback). Kept as the history of that decision.

## Summary
1. **We never chose 320 MHz / div 5. We inherited it.** awalol set it in 372e44a (2026-04-27, "optimize overclocking") and 5e7da17 (2026-05-13), and we forked at 0ed05d3 (2026-05-17). Upstream fixed flash timing (e5d99f0, 05-24, on `dev`; it only took effect with 99da904 on 06-08) and moved to 150 MHz (a023371, 06-12) after we had stopped syncing.
2. **The "stock clock breaks CYW43, tested" note has no surviving evidence.** It was written during the 05-17 rebase (4b6a72b) and the README line came the next day (bd2f33b). Any such test kept PIO div 5 from CMake, which gives a 30 MHz PIO at 150 MHz. Upstream and five forks have shipped 150 MHz with div 2 on the Pico 2 W since June.
3. **The XIP setup was missed as a correctness fix.** The 0.8.1 audit filed it as a "stock-clock speed prerequisite". At 320 MHz without it, flash runs at whatever divider the boot ROM chose for a 150 MHz world. d7f8a05 measured exactly that failure on Puya flash: choppy audio, while BT and HID kept working. It is now the lead suspect for issue #15.
4. **What 150 MHz needs that we lack:** core0's BT/USB hot path in RAM (upstream B.1–B.3, most of B.4, a2772a9, 57f185b, `audio_loop`). That is about 27 KB of code still running from flash in our build, plus the vreg/boot-delay skip and PIO div 2. Core1's audio path is already in RAM, the same as upstream's.
5. **Second confounder found:** our CI and releases build with Ubuntu's apt `gcc-arm-none-eabi`. On ubuntu-latest that should be GCC 13.2 (I inferred the version from the runner; I didn't check it). That is the toolchain upstream blamed for audio static on its Waveshare build (425061f). Locally you build with 14.2, and awalol v0.7.0 was built with ARM's official 14.2.

**Recommendation:** split flash setup from clock.
- **(A)** Embed the XIP setup at 320 MHz with flash divider 4, and pin CI to ARM 14.2. Ship it as a dev build now, and as a stable hotfix if F1 fixes Matt.
- **(B)** Move core0's hot path into RAM, still at 320 MHz.
- **(C)** Add a 150 MHz build option on the Development channel.
- **(D)** Measure with 0xFC and 0xF5.
- **(E)** Make 150 MHz the default only after your QC.

Batch 3 and the config-ABI ports stay out of scope unless you ask.

---

## 1. History

### Where 320 MHz / div 5 came from
| Date | Commit | What happened |
|---|---|---|
| 04-26 | 2fb3c2f, f497472 (awalol) | `set_sys_clock_khz(270000)` for "speaker work", then vreg 1.20 V |
| 04-27 | 372e44a (awalol) | 320 MHz plus `CYW43_PIO_CLOCK_DIV_INT=4`. The divider exists to keep the CYW43 PIO-SPI in spec *under the overclock*. |
| 05-13 | 5e7da17 (Antti Pohjola) | Made into CMake vars: Pico 2 W 320 MHz / div 5, Pico W 200 MHz / div 3 |
| 05-17 | 0ed05d3 | **Our fork point** (merge base with upstream/master) |
| 05-17 | 4b6a72b (ours) | CLAUDE.md: "Overclock 320 MHz @ 1.20 V is load-bearing. Dropping voltage to 1.10 V *or* clock to stock breaks the CYW43 PIO SPI bus … Tested." Now at CLAUDE.md:100. |
| 05-18 | bd2f33b (ours) | README:248, "at stock clock/voltage the CYW43 PIO SPI bus … is unreliable and pairing fails". Upstream's README had only said "1.2 V / 320 MHz; if it fails to boot, raise voltage or lower the clock". |

**The CYW43 note.** It was written during the rebase. No transcript of the test survives (the May sessions are gone). Only the clock or vreg calls in `main()` were runtime-editable; the PIO divider was a CMake constant fixed at 5. So a "stock clock" test ran the PIO at 150/5 = 30 MHz, not upstream's 150/2 = 75 MHz. At 320 MHz today it is 64 MHz. The "1.10 V at 320 MHz" case is just an undervolted overclock, not a CYW43 limit. The 10-11 audit reached the same conclusion: "very likely tested with divider 5 still in place."

### Upstream's clock and flash commits (none are in our master; checked with `merge-base --is-ancestor`)
- **e5d99f0 / 2014e22** (05-24): `PICO_FLASH_SPI_CLKDIV` 4 above 266 MHz, else 2. Inert on its own.
- **d7f8a05** (06-07, up2urheadlights): on RP2350 the boot2 is compiled in but not run. The boot ROM probes the flash and picks its own QMI setup. On the Waveshare board's Puya flash it chose CLKDIV 3 with 0xBB (`timing=0x60007203`), which is 106.7 MHz at 320 MHz, over Puya's 104 MHz. Result: "intermittent XIP read corruption … severely choppy audio … BT pairing and HID tolerated the occasional bad byte." The fix embeds boot2 with CLKDIV 4 (80 MHz) and quad 0xEB. The author scoped it to Waveshare and said the Pico 2 W auto-config "works correctly".
- **99da904** (06-08, awalol): made `PICO_EMBED_XIP_SETUP=1` unconditional for all boards. It has shipped in v0.7.0 (98c375a, 06-16) through current master c67c7f6.
- **a023371** (06-12): 320 → 150 MHz, PIO div 5 → 2, after RAM Phases A.1–A.3.
- **ec69301**: skips the vreg and the 1 s `sleep_ms` when at 150 MHz (upstream main.cpp:295-299 `#if SYS_CLOCK_KHZ != 150000`).

### Why it matters at 320 MHz too
In pico-sdk 2.2.0, `set_sys_clock_khz` never touches the QMI divider (hardware_clocks/clocks.c). Whatever the boot ROM picked is then multiplied by the PLL change. After every flash write, `flash_start_xip` re-runs "boot2" from BOOTRAM (hardware_flash/flash.c:30-75, 179-184), which for us is the boot ROM's own stub. With the setup embedded, crt0 copies our boot2 there (crt0.S:460, 540), so saves restore the right divider too.

Watch out: pico2_w.h defaults `PICO_FLASH_SPI_CLKDIV` to 2. Embedding without overriding it would give 160 MHz flash at 320 MHz. Upstream and our F1 variant both set 4.

### Our sync decisions
- **June:** syncing stopped once state_mgr diverged. Upstream deleted it in July and our native triggers depend on it (session c6bbfa5c, 10-10).
- **0.7.0 (10-10):** ported A.1 (core1 side), A.2, A.3, B.4 (queue ops only) and B.5. CHANGELOG:161 says "clock unchanged at 320 MHz". Memory `project_speaker_crackle_core1_ram.md` says the same.
- **0.8.1 audit (10-11, 180 commits):** proposed Batch 4, "stock clock in two steps": (A) B.1–B.4, 57f185b, a2772a9 and `audio_loop` to RAM at 320 MHz; (B) 150 MHz, div 2, vreg skip, then separately `PICO_EMBED_XIP_SETUP` with CLKDIV 2. Batches 1 and 2 shipped (1bb5978, c8d9cae). Batch 2's first try crackled the speaker. You then said "i dont want to do any more of these batches … this i feel will only serve to break shit" (`project_no_more_upstream_batches.md`: no stock clock unless you ask).
- **The #13 reply (10-11)** told the reporter the overclock "has to stay". The same session later called that outdated.
- **0.9.1 (10-11):** opt-in Development channel. CLAUDE.md:139 says to use it "to try risky firmware (e.g. upstream's clock changes)".
- **Fork research (10-12, app `docs/research/forks-2026-10.md` §1, row 3, item 9):** every active fork runs at 150 MHz. It lists our 150 MHz gap as "missing on purpose" and suggests a Development-channel experiment.
- **Now:** you've asked for all effort on issue #15. That is you bringing the clock back up, so the 10-11 "no more batches" stop no longer blocks this.

### Upstream commits since 0ed05d3 that we have NOT merged
| Group | Commits | Risk / value |
|---|---|---|
| **Flash / XIP** | 99da904, e5d99f0 / 2014e22 | Low risk, **high value**: deterministic, in-spec flash on every board at any clock. Lead fix for #15. |
| **Clock** | a023371 (150 MHz, div 2), ec69301 (vreg and boot-delay skip) | Medium–high risk (core0 margin, CYW43). Value: less heat and power, no overvolt, parity with all forks. |
| **Toolchain / SDK** | 425061f (ARM 14.2 in CI); 994f310 (SDK 2.3.0, GCC 15.2, newer TinyUSB); 898c352 (TinyUSB) | 425061f: low risk, medium value (removes a known audio-static toolchain). 994f310: medium risk, low value now; do it later on its own. |
| **RAM placement (core0)** | d360a04 (B.1, firmware BT handlers), 3b47ed5 (B.2), 56d79fb (B.3), 10fed2f (B.4 rest), a2772a9 (l2cap can-send-now), 57f185b (crc32 table; ours sits in flash at 0x100327d0), A.1 remainder (`audio_loop`), 76690ab (only matters on TinyUSB 0.21) | Low–medium risk, about 27 KB of RAM. Needed for 150 MHz, and helps at 320 MHz too. |
| **Audio** | 4929996 (16:1 haptic decimation, skip work when speaker off); 5a3be02 / a55fd46 / 91b3a28 (haptics filter and gain rollbacks); fa726d7 (upstream tried RESTRICTED_LOWDELAY and rolled back to AUDIO, no reason given; ours is RESTRICTED_CELT, which is different but worth knowing); 826be06 (core1 stack debug); ea93fad (mic/speaker select, config ABI) | Medium. Not needed for the clock; A/B them on 0xFC later. |
| **BT / USB / power** | 9923ce3 → caaff10 → 9ddb181 (power off controller on host sleep, suspend guards); edec7f7 / c67c7f6 (wake lineage); ae83907, 8a2f576 (Edge DS5-mode and profiles); 9ecedd2 (LED blink part) | Medium risk (USB suspend has a hardlock history). Value: moderate. Not in this plan. |
| **Features / config ABI ("batch 3/5")** | a7824d9 (MuteLight), cfca2a5 / aa5e012 (host mute, mic volume), 501d435 (500 Hz default), a109481 / 8f42593 / 0fba807 (trigger reduction), cc9be13 (speaker gain), ca1af99 (lock volume), 86da98c (GPIO status), 356b69c | Low–medium risk, needs app lockstep. You declined these on 10-11; out of scope. |
| **Already ported or N/A** | Batches 1 and 2 (a1492fd, 697ade0, 8c8b527, d7fb163, 8d8255c, 23a55da, 4f9f485, 83b4df9, ade9ea1), A.2, A.3, B.5, a38530f, 83dc61d, 329c0de, 8d25a38, bd4cac3, 44fbfee, 95d02fb, dbf2a71; b821623 never applied (we never had the ea93fad bug); CI, docs, Waveshare and config-tool commits | — |

The full per-commit table is in the 10-11 audit (subagent abeac1aa in session 650644e2).

---

## 2. What in our fork depends on 320 MHz

**Clock-dependent code**
- CMakeLists.txt:60-68 sets the values. src/main.cpp:490-493 always runs vreg 1.20 V, `sleep_ms(1000)` and `set_sys_clock_khz`.
- src/perf.h:37 `PERF_TICKS_PER_US = SYS_CLOCK_KHZ/1000` follows automatically.
- src/cmd.cpp:547 and src/oled.cpp:1001 report the configured clock (the measured clock and vreg are read live, so they stay correct).
- The OLED SPI is `spi_init(spi1, 10 MHz)` (oled.cpp:1865). At 320 MHz `clk_peri` is moved to 48 MHz; at 150 MHz, without `set_sys_clock_khz`, it stays at 150 MHz. Either way it lands close to 10 MHz.
- **App:** simulatedDongle.ts:229/308-313, tests/unit/protocol.test.ts:233-258 and tests/integration/bridgeClient.test.ts:488 hard-code 320000. docs/GUIDE.md:24 says "320 MHz at 1.20 V, which Bluetooth needs". README:248 and CLAUDE.md:100 are wrong as written.

**Core1 audio budget**
- Speaker chunks are about 10.7 ms with a 2-deep queue (audio.cpp:538-540).
- **There are no recorded core1 speaker-frame timings under load.** The only real 0xFC reading (10-12) had core1 speaker at 0.0 (no audio playing), a 17 µs average main-loop pass and a 36 ms worst case in the BT stage (reconnect).
- Core1 is RAM-resident (gated by tools/check_ram_residency.sh), so it scales about linearly with the clock. That means roughly 2.1× longer per frame at 150 MHz; the headroom is unmeasured.
- The CELT-only encoder and hardening-off (CMakeLists, dev.5) lower core1's cost and heap. That helps 150 MHz; they weren't adopted *because of* 320 MHz.
- Core1 still calls flash for soft-double, libm and malloc (memory, 10-10), so it is exposed to flash timing and XIP-cache contention.

**Core0 (scales about 2.1×, and pays XIP misses)**
- OLED render plus flush. dev.5 cut the flush to 129 SPI transfers and skips unchanged frames, but rendering runs from flash.
- Auto Haptics float work in `audio_loop`, which is still in flash.
- BTstack, CYW43 and TinyUSB pumps, all in flash. Only `queue_try_*` was relocated.
- The mic IN path has a 4-packet FIFO; the audit called it the main core0-latency risk.

**RAM headroom**
- Current dev build ELF (cache-issue15/build-pico2_w): .data 290 KB (including .time_critical) plus .bss 79 KB, ending at 0x2005a2c0. Matt's dev.6 showed 125 KB free at core1 start.
- Upstream's full relocation list costs about 27 KB more for us; I summed the symbols still in flash in our ELF.
- Three upstream symbol names don't exist on our TinyUSB 0.20 (`tu_fifo_{read,write}_n_access_mode`, `usbd_edpt_xfer_fifo`). Use the 0.20 names, or the renames silently do nothing; that is the 76690ab lesson.

---

## 3. Risks of moving to upstream's setup, and how to measure them

| Change | What could regress | How we'd see it |
|---|---|---|
| Embedded XIP at 320 MHz, CLKDIV 4 (80 MHz flash) | Flash may get *slower* than the boot ROM's choice (CLKDIV 3 would be 106.7 MHz), so core0's flash-resident code takes longer per XIP miss. Low correctness risk: upstream and forks have shipped it since June. | 0xFC core0 stages (Loop, CYW43, TUD, Audio, OLED) avg and max before/after. 0xF5 `drop_raw/enc/hap`. Flash writes after a save. The diag branch's 0xEA QMI readback should show CLKDIV 4 / 0xEB. |
| B.1–B.4 relocations | RAM pressure: the core1 heap and encoder create can fail (0.9.4 flag). A rename silently skipped. | 0xF5 `c1_free_kib` and the encoder-fail flag. An extended `check_ram_residency.sh`. 0xFC should improve. |
| 150 MHz, div 2, no vreg | Core1 speaker frame near the 10 ms budget (stutter, `Drop r`). Core0 loop jitter: mic IN underruns, haptics latency, BT pump delay. CYW43 bus errors or pairing (the old claim). OLED feels slower. | 0xFC `C1_SPEAKER` max well under 10 ms; Loop and CYW43 max. audio_diag.py drops at zero. Pairing and reconnect ×10. The OLED CPU screen (set, measured, vreg, temp). Your ears and test_speaker.sh, plus the haptics game test. |
| CI toolchain to ARM 14.2 | Little; it matches what you already build locally. | The same dev-build soak. |

**Tools we already have:**
- The app's Timing card (0xFC, reset with 0xF6 0x15).
- `scripts/audio_diag.py` (0xF5: drops, c1 loops and stage, flash_wr/fail, free heap).
- The OLED Diag `Drop r/e/h` row and the CPU screen.
- Host tests (`tests/host/run.sh`, including test_perf).
- `check_ram_residency.sh`.
- The diag branch's 0xEA (HardFault recorder, stack high-water mark, QMI readback). Keep the QMI readback permanently.
- The Development channel (`tools/release.sh X.Y.Z-dev.N`).
- The two background test agents (Linux and Windows VM).

---

## 4. Staged plan

**Stage 0 (in flight, not mine).** debug/issue15 has D, F1 and F3 (22bf6a8), and another agent is building F2 (150 MHz). Use Matt's 0xEA QMI readback as ground truth for the boot-ROM divider.

**Stage A: flash setup and toolchain at 320 MHz. Effort S (a few CMake lines plus a gate), then one owner soak evening.**
1. Port 99da904 and e5d99f0 using the upstream rule (CLKDIV 4 above 266 MHz, else 2) via `bs2_default`. This is the same change as F1.
2. CI and release: switch to ARM's official 14.2.Rel1 tarball (425061f's approach) so CI matches your local 14.2.
3. **Gate:** a CMake `FATAL_ERROR` unless RP2350 builds have `PICO_EMBED_XIP_SETUP=1` and `SYS_CLOCK_KHZ / PICO_FLASH_SPI_CLKDIV ≤ 100 MHz`. Plus an ELF check in CI that `.boot2` is non-empty.
4. Ship as dev.N. If F1 fixes Matt, cut a stable hotfix.

**Stage B: core0 hot path into RAM, still 320 MHz. Effort M.**
1. Port B.1 annotations, then B.2/B.3/B.4 (with the TinyUSB 0.20 names), a2772a9, 57f185b, and `audio_loop` to RAM.
2. Extend `check_ram_residency.sh` with the core0 list.
3. Record 0xFC and 0xF5 before/after. This is the 320 MHz baseline for C.

**Stage C: 150 MHz as a build option. Effort S code, S docs.**
1. Add `-DDS5_CLOCK=150|320`, defaulting to 320 for now. 150 sets 150000, PIO div 2, CLKDIV 2, and skips vreg and `sleep_ms(1000)` (a023371 plus ec69301). Pico W stays at 200 MHz / div 3.
2. Ship as a Development-channel build.
3. Update the 320-specific docs and the simulated dongle so they handle either clock.

**Stage D: measure on your hardware. Effort M (owner sessions), using the two background test agents.**
1. Same commit, both clocks, each scenario run about 10 min after a 0xFC reset:
   - idle, connected;
   - speaker music;
   - a haptics-heavy game;
   - mic on;
   - the OLED on the busiest screen;
   - a config save during audio;
   - ten reconnects.
2. Proposed pass criteria (my suggestion; set your own):
   - drops 0 and flash_fail 0;
   - C1 speaker max ≤ half of 10 ms;
   - core0 Loop max no worse than at 320 MHz plus a small margin, and below the mic FIFO depth;
   - pairing and reconnect times unchanged;
   - your ear test passes.
3. Turn the numbers into a hardware-in-loop gate script (read 0xFC, assert thresholds) for future releases.

**Stage E: make 150 MHz the default. Effort S.**
1. After dev soak with Matt and other Development-channel users, plus the Windows VM gate, flip the default and correct README, GUIDE and CLAUDE.md:100.
2. Keep `DS5_CLOCK=320` for one release, then drop it.
3. Optionally correct the #13 reply then.

**Later, each separate:** SDK 2.3 / TinyUSB 0.21 / GCC 15 (994f310, needs 76690ab), then 4929996-style audio savings measured on 0xFC. Batch 3/5 features only if you ask.

Nothing was edited, committed or flashed. I briefly created a temporary ref in the firmware repo during a fetch and deleted it right away (`git for-each-ref refs/remotes/issue15up` is empty); master is unchanged. Key files: /home/nhukette/projects/DS5Dongle/CMakeLists.txt (60-68, 150-195), /home/nhukette/projects/DS5Dongle/src/main.cpp (490-493), /home/nhukette/projects/DS5Dongle/CLAUDE.md (100, 107, 139), /home/nhukette/projects/DS5Dongle/README.md (248), /home/nhukette/projects/DS5Dongle/.github/workflows/build.yml and release.yml (apt toolchain), /home/nhukette/projects/DS5Dongle/tools/check_ram_residency.sh, /home/nhukette/projects/DS5Dongle-OLED-Config-Web/docs/research/forks-2026-10.md, ~/.claude/projects/-home-nhukette-projects-DS5Dongle/memory/project_no_more_upstream_batches.md.
