# DualSense Proton changelog

Our Proton build for playing Windows games on Linux with a DualSense through the DS5 Dongle OLED Edition: [GE-Proton](https://github.com/GloriousEggroll/proton-ge-custom) with a few DualSense fixes on top. Each build is named after the GE-Proton release it's based on, with `-DualSense` at the end; a rebuild of the same base adds `.2`, `.3`… (for example GE-Proton11-7.2-DualSense).

GE-Proton itself already brings the DualSense's own features to games through Proton: the controller is read directly (hidraw), so games that support the DualSense get its adaptive triggers and haptic feedback, and it keeps working when the controller is plugged in or reconnects while a game runs. The notes below list only what our build changes on top of that.

## GE-Proton11-7.2-DualSense - 2026-10-13 (not published yet)

Based on GE-Proton11-7, like the build before it.

### Added

- **Games that only know Xbox controllers can use the DualSense.** With `PROTON_PREFER_SDL=1` set for a game (the app's Games page sets it for XInput-only games such as Ghostrunner and Control), Proton now passes the controller to the game as a standard gamepad. Before, GE-Proton's DualSense support ignored that option and the game saw no controller at all.
- **Rumble in those games.** Games that use the controller as a standard gamepad (XInput) can make it rumble; before, every rumble request failed.

### Fixed

- **The right buttons, sticks and triggers on the standard-gamepad route.** The controller keeps its DualSense layout there, so buttons, sticks and triggers do what they should, and games that ask which controller it is still show PlayStation button prompts (Ghostrunner).
- **Stick up and down the right way round** for games that read the controller through DirectInput or as a HID device: up was reported as down.
- **Build:** the build no longer stops on its second run with an `aclocal` error (error 127) in xz. Nothing changes for players.

### Known limits

- Without `PROTON_PREFER_SDL=1` nothing changes: the game reads the DualSense directly, as in GE-Proton11-7-DualSense.
- Games that don't ask which controller it is show Xbox button prompts on the standard-gamepad route.
- Steam and Heroic remember Proton by its folder name: games set to GE-Proton11-7-DualSense keep using it until you pick GE-Proton11-7.2-DualSense for them (the app's standard-gamepad fix moves the game for you).

## GE-Proton11-7-DualSense - 2026-09-27

Based on [GE-Proton11-7](https://github.com/GloriousEggroll/proton-ge-custom/releases/tag/GE-Proton11-7). [Download](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/releases/tag/proton-GE-Proton11-7-DualSense).

### Fixed

- **Adaptive triggers and haptic feedback in games that use Sony's own controller library** (DualSense PC games such as Uncharted: Legacy of Thieves Collection). The DualSense reports its serial number as a Bluetooth address with colons, which Windows doesn't allow in a device's path, so those games couldn't open the controller to drive the triggers and haptics. Our build replaces those characters.

### Changed

- **Two earlier fixes are gone because GE-Proton11 has them:** reading the controller directly when another route is available (Wine's hidraw fallback), and games finding the controller's parent device (`CM_Get_Parent`, also needed by Sony's library).

### Known limits

- Turn off Steam Input for the game (Properties → Controller), otherwise Steam hands the game its own virtual controller instead of the DualSense.
- The first start of each game on a new build updates its prefix and can take a minute.
- Games that only know Xbox controllers see no controller with this build; GE-Proton11-7.2-DualSense fixes that.
