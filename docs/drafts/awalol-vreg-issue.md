# Draft: issue for awalol/DS5Dongle (not posted)

**Title:** Pico 2 W stays at 1.20 V after upgrading from a 320 MHz build / 从 320 MHz 固件升级后 Pico 2 W 仍保持 1.20 V

---

Hi awalol, thanks again for DS5Dongle!

Some news from my fork, [DS5Dongle OLED Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition): it has grown a lot since we last talked. It now has an OLED status screen, 4 pairing slots and a desktop configurator app (Linux / Windows / macOS) with per-game profiles. Today it moved to your 150 MHz + embedded XIP setup (a023371, 99da904). While testing that we found a small issue that affects upstream too.

**What happens:** at 150 MHz, `main()` skips the regulator entirely (`src/main.cpp`, the `#if SYS_CLOCK_KHZ != 150000` around `vreg_set_voltage(VREG_VOLTAGE_1_20)`). But the RP2350 keeps its VREG setting across every reset except power-on, including the reboot after copying a UF2 in BOOTSEL. So a Pico 2 W that ran a 320 MHz / 1.20 V build and is then flashed with a 150 MHz build keeps running at **1.20 V** until it's unplugged. 1.20 V is above the RP2350's 1.16 V operating maximum, so users who upgrade stay overvolted without knowing it.

**To reproduce:**
1. Flash a 320 MHz build (e.g. v0.6.x) and let it boot.
2. Without unplugging, enter BOOTSEL and flash a 150 MHz build (e.g. v0.7.x).
3. `vreg_get_voltage()` still returns `VREG_VOLTAGE_1_20` (code 13). After a replug it's 1.10 V (code 11).

Measured on hardware: before the fix, 150 MHz with code 13; with the fix, code 11 straight after flashing.

**Fix (one line):** set the default voltage instead of skipping the regulator:

```c
#if SYS_CLOCK_KHZ != 150000
    vreg_set_voltage(VREG_VOLTAGE_1_20);
    sleep_ms(1000);
    set_sys_clock_khz(SYS_CLOCK_KHZ, true);
#else
    vreg_set_voltage(VREG_VOLTAGE_DEFAULT);  // 1.10 V: the VREG keeps 1.20 V from older firmware until a power cycle
#endif
```

`vreg_set_voltage` waits for the regulator to settle, and lowering the voltage at the boot clock is safe, so no delay is needed. Our commit: [f6c235b](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/commit/f6c235b). Happy to open a PR if you'd like.

And thank you for the 150 MHz + XIP work. It fixed a user's board for us: an early A2-stepping RP2350 where our old 320 MHz builds corrupted flash reads, so core1 ran but never encoded audio and settings saves failed. Getting the clock and voltage back within spec is a big deal for Pico 2 W users.
