# DS5 Dongle OLED Edition: the guide

Step by step, from the parts on your desk to every setting in the app. Each section has a picture of exactly what it describes.

- [1. Build the dongle](#1-build-the-dongle)
- [2. First start: firmware and pairing](#2-first-start-firmware-and-pairing)
- [3. The Controller page](#3-the-controller-page)
- [4. Each part of the controller](#4-each-part-of-the-controller)
- [5. Calibration](#5-calibration)
- [6. The Dongle page](#6-the-dongle-page)
- [7. Games](#7-games)
- [8. App settings](#8-app-settings)
- [9. Troubleshooting](#9-troubleshooting)

## 1. Build the dongle

### Parts

| Part | Notes |
| --- | --- |
| **Raspberry Pi Pico 2 W** | The **Pico 2 WH** has the pin headers already soldered on; the plain Pico 2 W needs two 20-pin headers soldered. The original Pico W (not 2) works without audio. |
| **Waveshare Pico-OLED-1.3** (optional) | The 128×64 screen with two buttons (KEY0 / KEY1). SKU HIPI1798. Everything works without it; the app shows the screen either way. |
| **A USB cable that carries data** | Micro-USB on the Pico's end. Charge-only cables power the Pico but your computer never sees it: if nothing appears, try another cable first. |

### Putting it together

1. **Headers:** solder them on (skip this with a Pico 2 WH).
2. **The screen:** the OLED board plugs straight onto the Pico's headers, no wiring. Seat it with its **KEY0 / KEY1 buttons at the end away from the Pico's USB port** (in the photo below, the USB cable goes in on the right) and press it down evenly.
3. **Plug it in** (next section).

![A finished dongle: the Pico-OLED-1.3 seated on the Pico 2 W, KEY0 and KEY1 on the left, the USB cable going in on the right](screenshots/guide-hardware.png)

### Which USB port

**Use a USB 2.0 port** (usually the black ones, not blue). USB 3.0 ports and USB 3.0 extension cables give off radio noise right in the 2.4 GHz band Bluetooth uses: the controller then gets stuck on an **amber light bar** and never connects. If you only have USB 3.0 ports nearby, use a short **USB 2.0** extension cable or a powered **USB 2.0** hub to move the dongle a little away from them. The dongle takes its power from the USB port; it needs nothing else.

## 2. First start: firmware and pairing

### Install the firmware

The app includes the matching firmware, so this works offline.

1. **A new Pico:** just plug it in. **A Pico with other firmware on it:** hold its **BOOTSEL** button while you plug it in.
2. The app finds it and offers to **Install the firmware**. One click; keep it plugged in until it's done (your computer may also show a drive called RP2350: you don't need to open it).

### Pair your controller

Hold the **Create button** and the **PS button** on the controller until the light bar blinks. The dongle finds it and the app shows it a moment later. A controller that was paired before only needs the **PS button**.

### USB access (Linux)

On Linux, press **Set up USB access** on the Dongle page once (it asks for your password). It lets the app open the dongle, and on newer Ubuntu it also lets the app run inside its security sandbox.

## 3. The Controller page

Your controller (a DualSense in its colorway, or a DualSense Edge with its Fn buttons and back buttons), drawn in its own colors, moving as you use it: buttons light up as you press them, the sticks move, the light bar shows its real color. The **rail** on the right takes you to the other pages (hover it for names; pin it open with the button at the bottom, or Ctrl+B).

![The Controller page: the live drawing, the status tiles and the data cards](screenshots/live-controller.png)

- **Click any part of the drawing** to set it up: its settings open in the panel on the right. Or pick a setting from the list in that panel.
- **The tiles** under the drawing: battery, signal, light bar mode, and the player light and pairing slot.
- **Under the drawing's Mute button:** **Mic muted** while the controller's mute light is on, and **Headset in** while headphones are plugged into its headset jack.
- **The cards**: inputs (sticks, triggers, buttons, touch pad), gyroscope, accelerometer, and the connection (update rate, round trip, headset and mic).
- **Controller info:** the controller's own firmware (version, build date, hardware, bootloader, DSP, Bluetooth patch) with **Up to date** or **Newer official firmware available**, its battery (level, charge state, voltage), and the lifetime counters it keeps itself (time played, charging, haptic feedback and trigger time, charges, connections; in a fold-out, every button's presses and each stick's round trips). **How to update** explains Sony's way: a USB-C cable to a Windows PC with Sony's **PlayStation Accessories** app, or a PS5 (not through the dongle; pair the controller with the dongle again afterwards if needed). The app only checks Sony's version list; it never installs Sony firmware. Read only, and the controller's serial number is never read into the app.
- **Changes apply right away.** **Save to dongle** in the bottom bar keeps them after the dongle is unplugged; **Revert** goes back to what's saved.

## 4. Each part of the controller

### Light bar

![The Light bar panel](screenshots/guide-lightbar.png)

Pick a mode: **Game** (the game decides), one of your four **favorite colors** (FAV0–FAV3), or an effect (breathing, rainbow, fade). Set the favorites with the color pickers.

### Adaptive triggers

![The Adaptive triggers panel](screenshots/guide-triggers.png)

Try the trigger effects games can use (resistance, weapon, vibration…) on L2 and R2. Games set their own effects while you play; this is for feeling what they do and checking the triggers work.

### Haptic feedback

![The Haptic feedback panel with the left and right vibration intensity and the test buttons](screenshots/guide-haptics.png)

- **Vibration intensity**, per side: **Vibration intensity (left)** and **(right)**, with **Link left and right** to move both together. It scales both kinds of vibration games use: haptic feedback and classic vibration. (The triggers have their own motors; this doesn't change them.)
- **Test left / Test right / Test both:** vibrates that side for 3 seconds at its vibration intensity now, counting down on the button; press it again to stop early.
- **Audio Auto Haptics:** vibration made from the game's sound, for games that send none (or to add to theirs): **Fallback** (only when the game sends nothing), **Mix**, or **Replace**, with its own strength and low-pass filter.

### Speaker and microphone

![The Speaker panel with the live meter and the chime test](screenshots/guide-speaker.png)

- **Volume (Speaker for Controller)**, with a live meter of what's playing, and a test chime on the controller's speaker.
- **Microphone:** turn the controller's built-in microphone on or off (**Built-in microphone**), and test it: it records three seconds and plays them back on the controller (Linux).

### Button assignments

![Assigning a button](screenshots/guide-remap.png)

Click a button or stick on the drawing and choose what it **acts as**, or open **Buttons & layouts** (in the controller overview) to see every button in one list, with the changed ones marked. On a DualSense Edge the **Fn buttons** and **back buttons (LB / RB)** are in the list too: each can act as any button, stay itself, or do nothing. Button assignments are stored in the dongle and work in every game, on any computer.

**Saved button layouts:** save the buttons under a name ("Racing", "Southpaw") and give a layout to any game's profile. It switches in while that game runs (never written to the dongle's memory, so nothing wears out) and your normal buttons come back when it ends. Each layout lists what it changes ("Cross → Circle · L1 → R1"); edit it once and every game using it follows. Needs the newest dongle firmware.

### Pairing slots

![The pairing slots](screenshots/guide-slots.png)

The dongle remembers up to four controllers (slots 0–3). **Switch** to another slot, **Forget** one, or forget all. Each slot keeps its own calibration.

## 5. Calibration

![Calibration: the guided run and the raw vs corrected previews](screenshots/guide-calibration.png)

For stick drift, sticks that don't reach the edge, triggers that don't reach full, and a gyroscope that creeps. Open it from the settings list (**Calibration**).

1. **Start calibration** and follow the four steps, each with a short "get ready" pause first:
   1. let go of both sticks;
   2. roll both sticks slowly around their edges;
   3. press both triggers all the way, then let go;
   4. put the controller down and don't touch it.
2. Check the previews: **Raw** (what the stick really does) next to **What games see**. Adjust the **deadzone** and **full tilt** by hand if you like.
3. **Save to dongle.** It applies to every game right away.

A step that didn't go all the way (a trigger pressed halfway, the controller moved) keeps the old values and tells you which part to redo. Calibration lives in the dongle, per pairing slot; nothing is written to the controller, and **Reset to uncalibrated** undoes it.

**Sensitivity curve** (below the stick cards): how each stick responds between center and full tilt. Pick **Linear** (the stick as it is), **Precise** or **Steady** (a slow start for fine aiming), **Quick** (a quick start) or **Digital** (almost on/off), or **Custom** and drag its four points (or select one with Tab and move it with the arrow keys). The graph shows the curve against a dashed straight line and a dot where your stick is now; **Save to dongle** keeps it for this pairing slot, after the calibration, in every game. A game's profile can use its own curve per stick (pick it in the controller view while you edit the profile), used only while the game runs.

**Stick tests** (below the sensitivity curve): the **circularity test** draws the outline each stick reaches when you roll it around its edge against a perfect circle, with the average error (under about 10% is typical for a healthy DualSense), raw or with your calibration applied. The **drift test** watches the sticks for 10 seconds while you leave them alone and graphs any movement, so you can see whether to recenter or raise the deadzone.

## 6. The Dongle page

![The Dongle page: the console with the live screen, the dashboard below](screenshots/guide-dongle.png)

- **Dongle console:** the dongle's screen, pixel for pixel and live (even without the OLED add-on), and a **Log** of what happened this session. Change screens with KEY0 / KEY1 on the dongle.
- **The dashboard:** the Pico 2 W's chip temperature, CPU clock and core voltage; graphs of USB audio, Bluetooth traffic, signal and temperature over the last minute; the audio pipeline's levels and counters (anything that went wrong is marked); and the OLED's brightness, state and timeouts.
- **Timing** (firmware with protocol 1.11): how long each part of the firmware takes, average and worst case since the last **Reset**, for tracking down audio stutters.

![The dashboard's gauges and graphs](screenshots/guide-dashboard.png)

In the panel on the right:

- **Firmware:** what's installed and the latest version. **Check now** looks right away; an update is one click (the dongle restarts itself; press the PS button on the controller afterwards).
- **Device:** restart the dongle, enter BOOTSEL, factory reset (keeps pairings and button assignments), USB access (Linux).
- **Power:** disconnect the controller when idle, the timeout, the Pico's status light.
- **OLED display:** brightness, dim and off timeouts, whether controller input wakes the screen.
- **USB:** polling rate and controller mode (these apply after **Reconnect USB**).

## 7. Games

![The Games library](screenshots/guide-games.png)

The first time, the app asks before reading anything; it then lists your **Steam, Heroic and Lutris** games, with their artwork from the launchers' own caches (nothing is downloaded). On **Windows** it lists your **Steam, GOG Galaxy and Epic** games; Proton and the system checks are Linux-only, so they don't appear there.

- **Home:** launcher status, our **DualSense Proton** build (install or update it, make it Steam's default), system checks, and fixes it recommends across your games.
- **A game's page:**

![A game page](screenshots/guide-game-page.png)

  - **Play**, and links to its Steam properties, Steam Input layout, store page, install folder and Proton prefix.
  - **Controller profile:** only what this game changes from your normal settings (haptic feedback, Audio Auto Haptics, the audio buffer, speaker, light bar mode and favorite colors, mic, a saved **button layout** and each stick's curve), shown as chips; the × on a chip goes back to your normal setting. **Edit in controller view** puts the profile on the controller so you feel it while you edit (every panel then edits the profile; **Done** brings your normal settings back), and **All settings** is for quick edits. It switches in while the game runs and your normal settings come back when it closes (also after a crash). While you edit or the game runs, the profile is in the dongle's memory only, never saved to its flash.
  - **Setup:** this game's recommended fixes, applied with a backup you can undo.
  - **Compatibility:** which Proton it runs with, and the recommended one (with a one-click switch).
  - **DualSense support:** how well it works (Verified, Works, Needs setup, Partial, Broken) and per feature.
  - **Your rating** and a checklist of what you noticed, and private **notes**. Sharing with other players comes later.

## 8. App settings

![App settings](screenshots/guide-app-settings.png)

Open with the ⚙ in the rail.

- **Language.**
- **Appearance:** theme (**Match my controller**, light, dark, or your desktop's colors), style (**Standard** or **Glass**), accent color, and the look sliders: **card opacity** (let the game art through), **background dim**, **background blur** and **depth** (shadow strength).
- **Accessibility:** **Color vision** modes (colors never carry meaning alone anyway), **Reduce motion**, the **narrator** voice and captions.
- **Startup and window:** close to tray, start at login, start minimized.
- **Updates:** check automatically, install automatically, and the **update channel**: Stable (the default) or **Development**, which brings development builds of the app and firmware before they're released (newer, less tested), plus every stable release. **Back to stable** returns to the latest stable app and firmware.
- **Advanced:** **hardware acceleration**, and **HDR lighting** (experimental: on an HDR display the light bar glows brighter than white, at the peak brightness you set in nits).

## 9. Troubleshooting

| Problem | What to do |
| --- | --- |
| The light bar stays **amber** and never connects | Move the dongle to a **USB 2.0** port, or onto a short USB 2.0 extension away from USB 3.0 ports (radio noise; see [Which USB port](#which-usb-port)). Leave it 10–20 s: the firmware retries on its own. |
| **Windows:** "The dongle is plugged in, but Windows hasn't set up its driver", or it never connects | Press **Repair USB driver** on that screen, allow the admin prompt, then unplug the dongle and plug it back in. It happens on PCs where a real DualSense was plugged in by USB before (it uses the same USB IDs); do it again if that happens again. |
| Nothing shows up when the dongle is plugged in | Try another cable (charge-only cables don't carry data). On Linux, press **Set up USB access**. |
| "Not connected" | Press the **PS button** on the controller. After a firmware update or a slot switch it doesn't reconnect by itself. A new controller: hold the **Create button** and the **PS button**. |
| Settings reset after unplugging | They were applied but not saved: press **Save to dongle**. |
| The drawing doesn't move, or a page says "update the firmware" | Update the dongle's firmware from the Dongle page. |
| The narrator is silent | She speaks only through the controller's speaker, and only when the narrator is on (App settings → Accessibility). Check the controller's volume. |
| The app window doesn't appear | It may be in the tray: click the tray icon. |
| A soft reboot without unplugging | Hold **PS + Mute** for 2 seconds, or **KEY0 + KEY1** on the OLED for 1 second. |
