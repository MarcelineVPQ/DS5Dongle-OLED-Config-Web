## Upstream parity audit: issues, Pico 2 W safety and Edge gaps (read-only)

**Status (2026-10-13):** the XIP setup and 1.10 V at 150 MHz shipped in dev.8; Edge detection from report 0x20 (2efc855), the DS5-mode firmware report (ae83907) and the haptics half of 4929996 are in for dev.9. Still open, each a docs/BACKLOG.md row: PS Accessories profiles (8a2f576), SDK 2.3 / TinyUSB 0.21, the idle Bluetooth scan, the speaker buffer minimum and the guide's USB hub / low battery notes. The tables below are as audited.

**Summary**
1. **Pico safety:** we already have upstream's three hardware-safety fixes: SMPS PWM mode against coil whine (23a55da), the config moved off the RP2350-E10 sector (dbf2a71), and the boot `tud_disconnect` delay (4f9f485). The one we lack is the embedded flash (XIP) setup (99da904 + e5d99f0), which is already Stage A.
2. **Voltage:** 1.20 V is out of spec. The RP2350 datasheet gives DVDD a 1.16 V operating maximum and a 1.21 V absolute maximum, and the regulator can be ±3% off. So we sit above the operating limit on every board, and on some boards above the absolute maximum. At 150 MHz we would run on the default 1.10 V, which is within spec.
3. **Edge:** three upstream DualSense Edge fixes are missing: PS Accessories profiles (8a2f576), a fake DS5 firmware report when an Edge runs in DS5 mode (ae83907, which stops the failed "update available" prompt), and Edge detection from the firmware report (2efc855).
4. **DualSense V2 (CFI-ZCT2W / BDM-060):** reconnect failures and watchdog reboot loops were fixed only by the SDK 2.3 / TinyUSB 0.21 update (994f310 + 898c352, plus 76690ab). We're on SDK 2.2 / TinyUSB 0.20. None of our users has reported it yet.
5. **Already done or not applicable:** the USB-hub disconnect regression doesn't apply (we have no USB suspend handling), rumble lingering is fixed, and the ZCT2W haptics bug is covered by our unchanged HID descriptor. Two upstream bugs are still open and we probably share them:
   - Speaker audio garbles when `audio_buffer_length` is below 28 (#252).
   - Our idle Bluetooth scan never stops (#158/#162/#196).

### Upstream issues and fixes relevant to us
| Area | Upstream issue → fix | Us | Risk / value |
|---|---|---|---|
| Edge | #29, #155: PS Accessories profiles empty or not saved over the dongle → 8a2f576 (new `dse.cpp`) | **Don't.** We only forward 0x63–0x65. | Med / Med |
| Edge | #194, #197, #198: Edge in DS5 mode shows "firmware update available", update fails (FW-000007-5) → ae83907 | **Don't.** We pass the Edge's real firmware report under the DS5 ID. | Low / Med. The fake report pins a 2025 DS5 firmware version, so it will go stale. |
| Edge | Edge detection → 2efc855 reads byte 23 == 0x44 of report 0x20 | **Don't.** We probe with GET 0x70 (bt.cpp:600, 846). | Low / Low–Med. Prerequisite for ae83907. |
| DS V2 | #235, plus SundayMoments #90: ZCT2W reconnect fails or watchdog-loops → SDK 2.3 / TinyUSB 0.21 | **Don't** | Med / unknown until a ZCT2W user reports |
| DS V2 | #141: ZCT2W haptics only work with the speaker enabled → d317f2d (HID descriptor length) | **Have** (our 289-byte descriptor matches a real DualSense) | — |
| BT | #158, #162, #196: dongle grabs PS4 pads and phones, slow reconnects → upstream scans only 30 s at boot plus on a BOOTSEL click (PR #171 still open) | **Don't.** We restart the 30 s scan forever while idle (bt.cpp:383, 556). The slot filter limits the damage. | Med / Med (idle radio use, heat, reconnect time). Backlog. |
| BT | Reconnect speed (1d4dbad, ade9ea1), low polling at first connect (44fbfee), new-device connect (83b4df9) | **Have** (own `page_scan_fast`) | — |
| BT | `feature_data` cleared on connect instead of disconnect (3900f3d) | **Don't** (we clear on disconnect, bt.cpp:541) | Low / Low |
| USB | #148, #174: some USB hubs kill the controller → caaff10 (3 s suspend debounce) | **N/A** (we have no USB suspend callbacks). It applies if we ever add wake. | — |
| USB | #30, #57, #123, #137, #199, #213, #236: USB 3 radio noise, hub or USB 1.1 bandwidth costs haptics/audio | Hardware. The guide covers USB 3. | Docs: add "use a rear motherboard port, not a hub" and "instant disconnect = low controller battery" (#28, #222) |
| Pico | #124: dead Pico after coil whine; upstream blamed flash speed → e5d99f0 + 99da904 | **Don't** | Low / High (Stage A) |
| Pico | #268: coil whine → 23a55da SMPS PWM | **Have** (main.cpp:515) | — |
| Pico | #244: RP2350-E10 wipes config in the last flash sector → dbf2a71 | **Have** (flash_layout.h) | — |
| Pico | #55: freeze at boot → 4f9f485 | **Have** (main.cpp:503) | — |
| Pico | #55, #89, #129: some chips are only stable up to about 300 MHz at 1.2 V; an Edge with the speaker on crashed, which upstream blamed on the overclock | Applies to us at 320 MHz | Fixed by the move to 150 MHz (Stage E) |
| Pico | PR #82: switching clock at runtime hangs (`set_sys_clock_khz` blocks while BTstack waits) → watchdog reboot | Lesson only | Clock must stay a build-time choice (Stage C) |
| Toolchain | 425061f: Ubuntu's apt GCC 13.2 build gives audio static. In #235 the reporter's own build worked where the CI release failed. | **Don't** | Low / Med (Stage A) |
| Audio | #182: rumble lingers → 07ecbb3 | **Have** (equivalent) | — |
| Audio | #252 (open): packed 0x39 reports + `audio_buffer_length` < 28 = garbled speaker | Likely affected (we allow 16, default 64) | Low / Low. Raise the minimum to 28–32 (backlog). |
| Audio | #185 (open): haptics less detailed since 0.7.x → resampler rollbacks 5a3be02 / 91b3a28 | Not ported | A/B on the Timing card later (per the clock doc) |
| Audio | #183 (Horizon Forbidden West haptics stop after 4 s), #188 / #206 (speaker crackle on heavy rumble, FF7) | Unfixed upstream; unknown on ours | Add these games to Stage D test runs |
| Input | #24, #127, #234: gyro twitches in real-time polling → upstream says use 250/500 Hz | Our default is 250 Hz | OK |
| Triggers | #176, #240, #228: trigger strength (the #228 regression came from upstream's trigger-reduction feature) | You declined that feature, so N/A | — |

Also: upstream's `mic` branch has 8b9495c, 500 MHz at **1.60 V**. Never port it.

### Edge-specific gaps
- **Profiles (8a2f576).** On connect it sends a 0x65 handshake and a SET 0x80 unlock, then fetches profile reports 0x70–0x7B one every 80 ms. Profile reads are refused until that fetch finishes, and the profiles are re-read after a save. Watch out when porting: our `feature_data` keeps the report ID byte and upstream's (after 2efc855) doesn't, so the 0x65 offsets must be adapted.
- **DS5 mode (ae83907).** Today PS Accessories sees our DS5 ID with Edge firmware, offers an update, and the update fails.
- **Detection (2efc855).** Ours depends on a DS5 answering GET 0x70 with handshake 0x02. If a DS5 firmware ever answers differently, we never connect to USB.
- **Already fine:** Fn and back buttons (our remap), and the existing 0x63–0x65 profile-save forwarding.
- **Issue #15:** Matt's controller is an Edge (0x0df2). Upstream #129 (Edge with speaker on → disconnect after 5–7 s at 320 MHz) went away on a dev build for no clear reason. That fits the flash/overclock theory but doesn't prove it.

### Pico 2 W heat and voltage
- **Datasheet:** DVDD is 1.05 / 1.1 / 1.16 V (min / typ / max operating, Table 1688) and 1.21 V absolute maximum (Table 1680). The regulator is ±3% in normal mode, and the rated system clock is 150 MHz.
- **At 320 MHz:** 1.20 V programmed means 1.164–1.236 V on the pin. That is always above the operating maximum and can be above the absolute maximum, the "permanent damage" region.
- **At 150 MHz (upstream ec69301 skips the voltage call):** 1.10 V means 1.067–1.133 V, within spec.
- **Power:** my rough estimate is about 2.5× core dynamic power at 320 MHz / 1.20 V versus 150 MHz / 1.10 V (f·V²: 2.13 × 1.19). Leakage rises on top of that.
- **No thermal guard here or upstream.** The only protection is the regulator's own over-temperature shutdown. We already read the temperature, so Stage D can log it at both clocks.
- **Lowering voltage at 320 MHz doesn't help:** PR #271's notes say 1.15 V can still reach 1.18 V, and they retired a 375 MHz / 1.20 V profile after a board wouldn't boot.

### Merge list, by stage
- **A (320 MHz, flash + toolchain):** 99da904 + e5d99f0 / 2014e22 (flash divider 4 above 266 MHz), 425061f (ARM 14.2 in CI). Nothing else, so #15 results stay clean.
- **B (core0 hot path to RAM, still 320 MHz):** d360a04, 3b47ed5, 56d79fb, 10fed2f (with the TinyUSB 0.20 names), a2772a9, 57f185b, `audio_loop`.
- **C (150 MHz build option):** a023371 + ec69301 (150 MHz, PIO div 2, flash divider 2, no voltage call, no `sleep_ms(1000)`). Build-time only, per the PR #82 lesson.
- **D (measure), extra scenarios:**
  - Matt's Edge with the speaker on for 10 min (#129 repro);
  - 20 cold boots per clock (#55);
  - temperature at idle and under load at both clocks;
  - one run through a USB hub;
  - Horizon Forbidden West and FF7 haptics, if available;
  - a ZCT2W controller, if anyone has one.
- **E (150 MHz default):** flip the default and fix README:122 and :220, GUIDE:24 and CLAUDE.md:100. This removes the out-of-spec voltage.
- **Edge track, one dev build each, not inside A:**
  1. 2efc855 + ae83907 (small; can go between A and B or after E);
  2. 8a2f576 (profiles);
  3. after E: SDK 2.3 / TinyUSB 0.21 / GCC 15 (994f310, 898c352, needs 76690ab), the ZCT2W fix candidate.
- **Backlog, not merges:**
  - scan policy (boot plus BOOTSEL only, like PR #171);
  - `audio_buffer_length` minimum 28–32;
  - guide lines on hubs and low battery.

Nothing was edited, committed or flashed. I read all 237 upstream issues and PRs, our 18, and SundayMoments' relevant ones. Every "Don't" was checked with `merge-base --is-ancestor` against our master and by reading the code. Raw dumps are in `/home/nhukette/.claude/jobs/650644e2/tmp/issue15/gh/up/NNN.txt`, ours in `.../gh/ours/`, PR #271's clock notes in `.../gh/pr271/clocks.md`, and the datasheet text in `.../ds/rp2350.txt`.
