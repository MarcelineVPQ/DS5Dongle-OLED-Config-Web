# Button layouts: the whole remapping editor (design, 2026-11)

Status: design for the app half of protocol 1.24 ("Tension buttons"), replacing
the step-2 build (a separate Sets section, set editor and "Make a set"), which
the owner turned down on 2026-11-15: it duplicated the existing **Button
layouts** and none of the approved design showed on first open. The wire format
is the firmware's `docs/TENSION_BUTTONS.md` §3–§6 (unchanged); its §7 GUI
concept (Sets) is replaced by this document. The research report's GUI picks
(drawing in the middle, sentences per button, press the real button to pick it,
press the real key, colour-coded layers that inherit, plain warnings, live
truth from the board) stand.

## 1. One system: Button layouts

There is one thing a player makes: a **button layout**. It already exists
(Controller page → Button assignments → Button layouts: named, Load / Update /
Delete, Save as layout; a game's profile picks one). It grows to hold
everything:

- per button: **Press**, **Hold** (with a time), **Double press**, **With PS**,
  **Toggle**, **Turbo** (with a rate); targets: a controller button, a key with
  modifiers, a mouse button, mouse motion or the wheel, a layer, the gyro, or
  Disable;
- up to three **layers** over the base (each button "same as base" or its own);
- **gyro as mouse** (or as the right stick);
- the layout's **trigger effects** (L2 and R2, today's Tension programs), edited
  in Adaptive triggers.

On the wire a layout is exactly one 494-byte board record (SetBody 134 +
ButtonPart 360, `TENSION_BUTTONS.md` §3.1). Words: the UI never says "set".
The board's eight records are "layouts on the board".

### Where a layout lives

| Home | What | Written by |
|---|---|---|
| **The editor** | The layout being edited: what Button assignments, the drawing and Adaptive triggers show | edits are drafts |
| **On the board** (8 slots, 0x1C/0x1D) | Runs without the app; one of them **runs from power-on** (the saved choice, 0x20) | the save bar |
| **This PC's library** (`layouts` in the library file) | Named layouts for games and for later | Update / Save as layout / Delete, at once (as today) |

The editor always edits **the layout that runs from power-on**, as today's
editor edits the board's buttons: Load copies a layout into the editor, the
save bar's **Save to the board** writes the editor into the slot that runs from
power-on (none runs yet: the first free slot, which then runs from power-on;
all eight used and none runs: the row **Saves into** picks the slot to
replace). Revert drops it. With a game's profile on, the editor edits that
game's layout instead and **Save to profile** saves it into the library (as
today's buttons do).

A library layout is **on the board** when a slot holds the same 494 bytes
(CRC-32 of the wire, the list's slot CRCs, §6.3). The list shows one row per
layout: library rows, plus board slots no library row matches (made on another
PC, by the OLED later, or by the step-2 build), so nothing on the board is
hidden.

### A game's layout

A profile names a library layout (unchanged field `buttonLayout`). While the
game runs (`profileDongle.ts`), on firmware with layouts on the board
(identity [58] bit0):

1. the layout is on the board → that slot runs for now (0x20, temporary);
2. else, with [58] bit6 → it is sent for now (0x22, RAM only);
3. else → its Press part goes as today's temporary table (0x11/0x13) and no
   board layout runs meanwhile (0x20 0xFF temporary), so the table is what the
   game gets. The game page says, in plain words, what doesn't come along
   (hold, layers, keys, trigger effects) with **Edit on the Controller page**,
   where **Put on the board** fixes it.

0x12 at the end, then 0x20 0xFE (back to the saved choice). Older firmware:
today's path (table, extras, the trigger-effects slot by its own row).

## 2. Screens, in plain words

### 2.1 First open of Button assignments (firmware with [58] bit0)

No prerequisite, no empty state: the editor is there.

- **Header status**: `desktop.buttons.status` "{{name}} · {{count}} changed"
  (`statusLayers_one/_other` adds " · {{count}} layer(s)").
- The drawing shows **badges on changed buttons only** (in the layer shown):
  the new job as Sony's glyph or a short name ("✕", "L1", "F5", "Mouse L",
  "Off"), a dot when the button has more than a Press. Same-as-base buttons in
  a layer show the base's badge dimmed; the button that enters a layer wears
  its colour.
- Body, top to bottom:
  1. **Name** (`desktop.buttons.name`, sub `desktop.buttons.nameSub` "16
     characters, English letters only"): the name the board keeps.
  2. **Saves into** (`desktop.buttons.saveInto`, only when all 8 slots are used
     and none runs from power-on).
  3. **Button** (`desktop.buttons.pick`): a select of the sources, hint
     `desktop.buttons.pickHint` "Click a part, or press it on the controller."
     With none chosen: the **Changed** list (`desktop.buttons.changed`), one
     sentence per changed button (`changedLine` "{{from}} → {{to}}"), each a
     link that picks it; empty: `noneChanged` "Every button is itself in this
     layer."
  4. **The chosen button** (`does` "{{button}} does"), at most five rows, each a
     sentence: **Press** → [target]; **Hold** [time] → [target]; **Double press**
     → [target]; **With PS** → [target]; **Toggle** / **Turbo** switches (+
     `turboRate` "{{n}} a second"). An unset row's target button reads
     `notSet` "not set" (picking a target sets it, Disable/Nothing clears it):
     nothing greyed out. PS: Press is `psFixed` "PS button (always)", only Hold
     and Double press. Toggle and Turbo only when Press can take them (§3.5
     rule 5). A row whose firmware piece is missing ([58] bit1) is absent.
     In a layer, first **Same as base** (`desktop.layers.sameAsBase`): on = the
     base's rows read-only; off = an editable copy.
     Then **Swap with…** and **Reset this button**, then its warnings.
  5. **Layer** group (on a layer tab, [58] bit2): Name (`desktop.layers.name`,
     10 characters), Colour (six swatches, `desktop.layers.colour`), **Entered
     by** (`enteredBy`: the buttons whose target is this layer, each a link; or
     the warning `layerNoEntry`), Gyro in this layer (`desktop.layers.gyro`:
     Same as base / On / Off, with [58] bit5), **Reset this layer**, **Delete
     layer** (danger, last in the group).
  6. **Start from** (`desktop.buttons.presets`): One hand (left), One hand
     (right) (both need [58] bits 1 and 2), Toggle instead of hold (bit 1).
     Drafts like any edit; ⓘ: starting points, not tested designs.
  7. **Live from the board** (`desktop.buttons.live.title`, [58] bit3): the
     section's live meter (page rule 5, Q2).
  8. **Button layouts** (the list, §2.4).
  9. **Reset all** (`desktop.live.remapReset`), danger zone, last: every button
     of the layout back to itself and its layers gone.
- The **layer tabs** sit above the drawing while Button assignments is open
  ([58] bit2): `desktop.layers.base` "Base", each layer's name (empty =
  `defaultName` "Layer {{n}}") in its colour token, `desktop.layers.add` "+
  Layer" while fewer than three. A tab is navigation, never a setting. A tab
  with changes carries a dot. A `tablist` (arrows, Home, End).

### 2.2 The target picker

One popover per row (top layer, focus trap, Escape back to the row's button,
arrow keys inside), tabs `desktop.buttons.tab.*`, each only when its piece is
there:

- **Controller**: Sony's glyphs in a grid laid out like the controller (L2 L1 /
  R1 R2; D-pad left; △ ○ ✕ □ right; Create, PS, Touch pad, Options; L3, R3),
  roving tabindex, the button itself marked "(default)", and **Disable**
  (`remap.disabled`).
- **Key** ([58] bit4): **Press a key…** (`target.pressKey`): armed on click or
  Enter, the next key down is taken with the modifiers held, Escape cancels,
  Tab is never captured unless armed; **Ctrl / Shift / Alt / Win ⌘**
  (`mod.*`, left modifiers, HID order); **Show all keys** (`target.showAll`):
  every key by group (letters, digits, function, navigation, editing, keypad).
  Key names are the US names of the HID usage (the browser's layout map is not
  used: unverified in Electron).
- **Mouse** ([58] bit4 for buttons, bit5 for motion): Left, Right, Middle, Back,
  Forward; Move ↑ ↓ ← →, Wheel ↑ ↓, with **Speed**.
- **Layer** ([58] bit2, with a layer): each layer, **While held** / **Switch**.
- **Gyro** ([58] bit5, gyro on): On while held / Off while held / On or off.

### 2.3 Warnings (exact words, `desktop.buttons.warn.*`)

Inline, under the row they concern, ≤ 60 characters, detail behind ⓘ.
`holdCost`, `doubleCost`, `psCost`, `noCross`, `noCircle`, `duplicate`,
`needsKeys` (+ **Turn on**: drafts the Keys and mouse setting), `reconnect` (+
**Reconnect**), `paused`, `layerNoEntry`, `full`, `sixKeys`, ⓘ-only
`promptsInfo` and `triggerEffectInfo`. Texts: `TENSION_BUTTONS.md` §7.6, with
"set" replaced by "layout" (`full`: "This layout has no room for more
changes."). `noLinux` waits for the USB probe's result (open question).

### 2.4 Button layouts (the list)

One row per layout (§1): name, chips **On the board** (`layouts.onBoard`) and
**Runs from power-on** (`layouts.runs`), the summary of its changes, "used by N
games". Buttons per row: **Load**, **Update** (into the library at once; when
it's on the board, its slot is also staged for the save bar), **Put on the
board** / **Take off the board** (staged; the save bar writes them;
`layouts.boardFull` when eight are used), **Run from power-on** (staged),
**Delete** (library; a board-only row: take it off). Then **Save as layout**.
The texts say "layout" and "on the board", never "set".

### 2.5 Adaptive triggers

With [58] bit0 the Tension group edits **the layout in the editor's** L2 and R2
(unchanged editor), with **Start from** (`desktop.tension.presets`, labelled as
trigger effects: Bow, Heavy trigger, Brake pedal, Machine gun; they replace
L2/R2 only, the buttons stay) and **Feel it** (runs the editor's layout,
unsaved). The live meter "Tension now" and the trigger test stay.

On 1.23 firmware (Tension without layouts on the board) the group keeps its
slot editor (Runs from power-on, Slot to edit, Name, Feel it, Start from, Clear
this slot), reworded without "set".

### 2.6 Gyroscope

Group **Gyro as mouse** (`desktop.gyroMouse.*`, [58] bit5) for the layout in
the editor: Gyro Off / On / With a button, Moves Mouse / Right stick, Turn
with Yaw / Roll, Speed across / up and down (1–255), Invert across / up and
down, Steadiness (0–255), and `needsKeys` when it moves the mouse with keys and
mouse off.

### 2.7 Pico 2 W page

**Keys and mouse from the controller** stays as built (Connection to the PC).

## 3. States

- **Older firmware** (no [58] bit0): today's list (`AllButtonsList`, the
  legacy table), the update hint `desktop.buttons.needsFirmware` (MUST-SHOW)
  with the Firmware link, and Button layouts as today. Nothing greyed out.
- **Newer firmware piece missing** ([58] bits 1..6): its rows, tabs, presets
  and blocks are absent.
- **Reading the board's layouts** (once per connection): the section shows
  `desktop.tension.reading`; a read error shows with Read again.
- **Saved by newer firmware** (read-only store): `desktop.tension.readOnly`,
  and the legacy list.
- **No controller**: editing works; Live from the board says
  `live.noController`.
- **Narrow window** (900×650): the panel is the drawer; the layer tabs wrap
  under the drawing's title; badges show glyphs (the full sentence in their
  tooltip); the popover is at most the drawer's width.
- **Keyboard only**: Tab reaches the tabs, the parts (already buttons), the
  section; every popover traps focus and Escape returns; the key field is armed
  only by a click or Enter, and Show all covers every key it can't catch.

## 4. Idle cost, per visual

| Visual | Shown and idle | Hidden | CPU fallback |
|---|---|---|---|
| Badges on the drawing | 0 fps: a static SVG group redrawn only when the layout, the layer tab or the badges change | nothing | same |
| Layer tabs | 0 fps: plain buttons | nothing | same |
| Target picker | 0 fps; listeners only while open | closed | same |
| Live from the board | GET 0xE8 30 times a second only while Button assignments is open, [58] bit3 and the window shown (`usePoll` pauses hidden); an unchanged reply keeps the last object, so nothing re-renders | no polls | same |
| Hold ring in the live line | one CSS animation, `steps(10)`, only while the board reports a deciding press: ≤ 10 repaints a second | none | ≤ 10 repaints a second |
| Keys and mouse pause | 0xF6 0x21 once a second while the window is focused, the Controller page shown and keys can be sent ([58] bit4, interface up) | stops (the board ends the pause by itself after 2 s) | same |

## 5. Data

- Library layout (`ButtonLayoutSchema`): `name`, `table`, `extra`, `updated`,
  plus optional **`set`**: the 494-byte wire as 988 lowercase hex digits.
  `table`/`extra` stay the layout's Press part as today's 16 + 4 entries
  (`legacyFromPart`), so older firmware and a game's fallback still get it.
- The editor, the slot drafts and the saved choice live in `tensionDraft.ts`
  (one draft, saved by the bar: deletes, then slots, then the choice).

## 6. String keys

`desktop.buttons.*`: status, statusLayers_one/_other, name, nameSub, saveInto,
pick, pickHint, pickNone, changed, changedLine, noneChanged, does, row.press /
hold / double / withPs / toggle / turbo, holdTime, turboRate, notSet, psFixed,
swap, resetButton, presets, presetsInfo, preset.oneLeft / oneRight / toggle,
needsFirmware, tab.controller / key / mouse / layer / gyro, target.title /
gridHint / pressKey / pressKeyArmed / showAll / keyText / modsOnly, keyGroup.*,
mod.ctrl / shift / alt / gui, mouse.left / right / middle / back / forward,
move.up / down / left / right, wheel.up / wheel.down, speed, layerMode.held /
switch, gyro.held / offHeld / switch, warn.* (§2.3), turnOn, reconnect,
live.title / line / wouldSend / idle / noController / nothing / type.*,
badge.create / options / touchpad / mouse, defaultName.
`desktop.layers.*`: base, defaultName, add, tabs, sameAsBase, name, nameSub,
colour, colourN, enteredBy, enteredLine, gyro, gyroMode.same / on / off, reset,
delete, title.
`desktop.gyroMouse.*`: title, mode, mode.off / on / button, buttonHint, use,
use.mouse / stick, axis, axis.yaw / roll, speedH, speedV, invertH, invertV,
steadiness, steadinessInfo.
`desktop.layouts.*` adds onBoard, runs, putOnBoard, putOnBoardHint, takeOff,
runFromPowerOn, boardFull, boardOnly, needsBoard; hint / loadHint / deleteHint
reworded.
`desktop.tension.*` adds presets, presetsInfo; the slot editor's strings drop
"set". Removed: `desktop.sets.*`, `desktop.sections.sets`,
`desktop.buttons.legacyHint / makeSet / makeSetReplace / emptySlot / setLeaves
/ useInSet`.

## 7. Open questions for the owner

1. **Downgrading the app**: an older app reading a library layout that carries
   `set` drops that layout (its strict schema) and keeps the damaged file
   aside, as for any damaged library. Acceptable for the Development channel?
   (The alternative is a separate file for the layouts' wire.)
2. **A game's layout not on the board, firmware without 0x22**: the game gets
   the Press part only and the game page says what's missing (§1). Or should
   starting a game put its layout on the board by itself? (Recommend no: no
   flash writes from game starts.)
3. **Keys and mouse on Linux** (`noLinux`): waits for the USB probe.
</content>
</invoke>
