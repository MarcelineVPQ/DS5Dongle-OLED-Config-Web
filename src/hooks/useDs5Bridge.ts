import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { causeText } from "../desktop/shownError";
import { useTranslation } from "react-i18next";
import { type BridgeIdentity, Ds5BridgeClient, FEATURES3, type FirmwareIdentity, type OledPadButton, sameIdentity, supportsFeature3 } from "../protocol/bridgeClient";
import { type BoardEntry, type BoardSummary, OTHER_BOARDS_MS, entryTransport, lastBoardId, listBoards, pickBoard, readSummaries, rememberBoard, rememberKey, summaryOf } from "./boards";
import { ConfigBody, DEFAULT_CONFIG, ConfigValidationIssue, configsEqual, normalizeConfig, validateConfig } from "../protocol/config";
import { WebUsbTransport, isDongle, webUsbAvailable } from "../protocol/webUsbTransport";
import { SimulatedDongle } from "../protocol/simulatedDongle";
import type { Ds5Transport } from "../protocol/transport";
import { simulatedBoard } from "../desktop/devPreview";
import { KeyedError, logged } from "../errorText";
import { isWindowShown } from "../desktop/useWindowShown";
import type { BoardHolder } from "../desktop/api";

// While the window is hidden, an animated lightbar (rainbow, breathing, a
// charging pulse) changes the identity on every 1 s poll, and each change
// re-rendered the whole app (a hidden window still draws its frames: GPU
// process and renderer) and redrew the tray icon (measured hidden with an
// animated lightbar: ~4.9% of a core). Hidden, a change in nothing but the
// lightbar color is taken once the color holds for one poll (a new static
// color reaches the tray icon a second later), and while it keeps changing at
// most every HIDDEN_LIGHTBAR_MS. Any other change is taken at once, and so is
// everything while the window is shown.
export const HIDDEN_LIGHTBAR_MS = 60_000;
export function takeIdentity(prev: BridgeIdentity | null, next: BridgeIdentity, shown: boolean, lightbarSteady: boolean, takenAt: number, now: number): boolean {
  if (sameIdentity(prev, next)) return false;
  if (shown || !prev || lightbarSteady || now - takenAt >= HIDDEN_LIGHTBAR_MS) return true;
  return !sameIdentity({ ...prev, lightbar: null }, { ...next, lightbar: null });
}

type Operation = "connecting" | "reading" | "applying" | "saving" | "reconnecting" | null;
type SaveState = "idle" | "dirty" | "applied" | "saved";

export interface UseDs5BridgeResult {
  supported: boolean;
  client: Ds5BridgeClient | null;
  identity: BridgeIdentity | null;
  // Protocol 1.21 (0xEA): what the board and its firmware are, read once per
  // connect; null on older firmware (then the board's name stands in).
  firmwareIdentity: FirmwareIdentity | null;
  firmwareVersion: string | null;
  deviceLabel: string;
  config: ConfigBody | null;
  // What the dongle has in flash, as far as this app knows: the config read at
  // connect, updated on every successful save.
  savedConfig: ConfigBody | null;
  // From the dongle itself when the firmware reports it (identity [19]):
  // true after an app restart or USB reconnect with unsaved changes, false
  // after a slot switch (which saves). Else compared against savedConfig.
  hasUnsavedChanges: boolean;
  // Revert needs to know what's in flash: only after a save or a connect
  // without unsaved changes.
  canRevert: boolean;
  draft: ConfigBody;
  issues: ConfigValidationIssue[];
  saveState: SaveState;
  operation: Operation;
  // error: SHOWN — desktop.errors.usb.network, the keyed board errors and the rest (causeText): DesktopApp's ErrorNotice with Dismiss
  error: string | null;
  statusText: string;
  isConnected: boolean;
  isDirty: boolean;
  setDraftField: <Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => void;
  connect: () => Promise<void>;
  readConfig: () => Promise<boolean>;
  // Resolves false if the dongle refused or the transfer failed (see error).
  applyConfig: () => Promise<boolean>;
  saveToFlash: () => Promise<boolean>;
  reconnectUsb: () => Promise<boolean>;
  // Protocol 1.14: the PC sleep options (POWER_FLAGS bits), saved on the
  // dongle right away; identity.powerFlags shows them once it has.
  setPowerFlags: (bits: number) => Promise<boolean>;
  // Protocol 1.18 (identity [46] bit 6): the board's KEY0 / KEY1 can be pressed from the app.
  supportsOledKeys: boolean;
  // Press KEY0 (0) or KEY1 (1), short or long, as a finger on the board would
  // (KEY0 next screen; KEY1 short back, long next brightness). Resolves false
  // if the dongle refused (see error); the 0xEF mirror shows the result.
  pressOledKey: (key: 0 | 1, long: boolean) => Promise<boolean>;
  // Protocol 1.19 (identity [46] bit 7): controller buttons for the OLED screens.
  supportsOledPad: boolean;
  // Press a controller button for the board's screens only (never the
  // games), held holdMs (0 = a tap). Resolves false if refused (see error).
  pressOledPad: (button: OledPadButton, holdMs?: number) => Promise<boolean>;
  resetDraft: () => void;
  // Put the dongle back to savedConfig (RAM only; flash already holds it).
  revertToSaved: () => Promise<void>;
  // Put this exact config on the dongle (RAM only) and make it the draft:
  // per-game profiles switching in and out.
  applyBody: (body: ConfigBody) => Promise<boolean>;
  clearError: () => void;
  // The board is plugged in but another program holds it (WebUSB's "Unable
  // to claim interface"): what's holding it where the main process can tell
  // (Linux), else an empty list. The app tries again every BUSY_RETRY_MS by
  // itself and connects once it's free; retryBusy tries now.
  // error: SHOWN — desktop.boardBusy.* (BoardBusyNotice), in place of the raw WebUSB error
  busy: { holders: BoardHolder[] } | null;
  retryBusy: () => Promise<void>;
  // Every board on USB (any number), in a steady order, the one on screen
  // included (its row from its live poll; the others read every
  // OTHER_BOARDS_MS while the window is shown). Empty without boards.
  boards: BoardSummary[];
  // The key of the board on screen (BoardSummary.key), null without one.
  currentBoard: string | null;
  // Show another board (and flash its OLED, protocol 1.20); the one on
  // screen just flashes its OLED. Remembered as the board to show next start.
  selectBoard: (key: string) => Promise<void>;
  // Flash a board's "THIS ONE" screen (protocol 1.20; older firmware: nothing).
  identifyBoard: (key: string) => Promise<void>;
}

// How long a board that left USB on purpose (BOOTSEL for an update, a
// reboot) is waited for before another board is shown: an update's BOOTSEL,
// write and restart take well under this.
export const EXPECT_BACK_MS = 90_000;

// How often the app tries the board again while another program holds it.
// One claim attempt (no reads), also while hidden: the tray shows when it connects.
export const BUSY_RETRY_MS = 2000;

// WebUSB's errors from open() / claimInterface() (DOMException NetworkError
// or NotFoundError: "Unable to claim interface", "The device was disconnected").
export function isOpenFailure(cause: unknown): boolean {
  return cause instanceof DOMException && (cause.name === "NetworkError" || cause.name === "NotFoundError" || /claimInterface|open/.test(cause.message));
}

// Another program holds the board: claimInterface's "Unable to claim
// interface" (every OS). On Windows and macOS opening a device that another
// program has open already fails ("Access denied.", the OS gives one program
// at a time); on Linux that error is the missing udev rule instead (Set up USB
// access), so there only the claim counts.
export function isBoardBusy(cause: unknown, platform: string | undefined): boolean {
  if (!(cause instanceof DOMException)) return false;
  if (cause.name === "NetworkError" && /claim/i.test(cause.message)) return true;
  return platform !== undefined && platform !== "linux" && isOpenFailure(cause) && cause.name !== "NotFoundError";
}

// A connect that failed for a passing reason (the board was slow to answer,
// a transfer hiccup) is tried once more, quietly, after CONNECT_RETRY_MS. A
// protocol mismatch, firmware this app can't read, an unplugged or busy board
// are not: trying again changes nothing (busy and replugging retry on their own).
export const CONNECT_RETRY_MS = 300;
const PASSING_CONNECT_ERRORS = new Set(["desktop.errors.board.timeout", "desktop.errors.board.short", "desktop.errors.board.transfer", "desktop.errors.board.otherProgram"]);
export const isPassingConnectError = (cause: unknown): boolean => cause instanceof KeyedError && PASSING_CONNECT_ERRORS.has(cause.key);

export function useDs5Bridge(): UseDs5BridgeResult {
  const { t } = useTranslation();
  const supported = webUsbAvailable();
  const [client, setClient] = useState<Ds5BridgeClient | null>(null);
  const [identity, setIdentity] = useState<BridgeIdentity | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);
  const [firmwareIdentity, setFirmwareIdentity] = useState<FirmwareIdentity | null>(null);
  const [config, setConfig] = useState<ConfigBody | null>(null);
  const [savedConfig, setSavedConfig] = useState<ConfigBody | null>(null);
  const [draft, setDraft] = useState<ConfigBody>(DEFAULT_CONFIG);
  const [operation, setOperation] = useState<Operation>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ holders: BoardHolder[] } | null>(null);
  const busyRef = useRef(busy);
  // lifetime: OK — acquires nothing (mirrors the busy state into a ref)
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const clientRef = useRef<Ds5BridgeClient | null>(null);
  // The board on screen (its BoardSummary.key), for the board stack.
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const currentKeyRef = useRef<string | null>(null);
  // A board that left USB on purpose (BOOTSEL, reboot, USB reconnect: the
  // client's onLeaveBus) and is expected back: until `until`, autoConnect
  // waits for it instead of showing another board (a firmware update must
  // come back to the board it wrote). By its remembered id.
  // cache: OK — key=none (the one board expected back); invalidated=cleared when it connects, on a switch, or after its deadline; bound=1 entry
  const expectRef = useRef<{ id: string; until: number } | null>(null);
  const expectBack = useCallback((c: Ds5BridgeClient) => {
    const id = rememberKey({ boardId: c.boardId, serial: c.transport.serial ?? null });
    if (id) expectRef.current = { id, until: Date.now() + EXPECT_BACK_MS };
  }, []);
  // lifetime: OK — acquires nothing (mirrors the client into a ref)
  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  const issues = useMemo(() => validateConfig(draft), [draft]);
  const isConnected = Boolean(client?.isOpen);
  const isDirty = !configsEqual(config, draft);
  const deviceLabel = client ? client.transport.label : t("device.noDevice");

  const statusText = useMemo(() => {
    if (!supported) return t("statusText.webusbUnavailable");
    if (operation) return t(`statusText.${operation}`);
    if (!client) return t("statusText.ready");
    if (isDirty) return t("statusText.unsaved");
    if (saveState === "applied") return t("statusText.applied");
    if (saveState === "saved") return t("statusText.saved");
    return t("statusText.connected");
  }, [client, isDirty, operation, saveState, supported, t]);

  const detach = useCallback(() => {
    setClient(null);
    setIdentity(null);
    setFirmwareIdentity(null);
    setFirmwareVersion(null);
    setConfig(null);
    setSavedConfig(null);
    setDraft(DEFAULT_CONFIG);
    setSaveState("idle");
  }, []);

  // What holds the board (Linux: the main process looks; elsewhere nothing to name).
  const lookUpHolders = useCallback(() => {
    const desktop = window.desktop;
    if (!desktop?.boardHolders) return;
    desktop
      .boardHolders()
      .then((holders) => setBusy((prev) => (prev ? { holders } : prev)))
      .catch(logged("naming the program that holds the board (the busy notice says it without a name)"));
  }, []);

  // `quiet`: the busy retry, which doesn't flash "Connecting…" every 2 s.
  const attachTransport = useCallback(
    async (transport: Ds5Transport, quiet = false, key: string | null = null): Promise<boolean> => {
      if (!quiet) setOperation("connecting");
      try {
        // loop: SERIAL-REQUIRED — retry/backoff: one quiet second try after a passing error (isPassingConnectError), never more
        for (let attempt = 0; ; attempt++) {
          try {
            const next = new Ds5BridgeClient(transport, { onLeaveBus: expectBack });
            // lifetime: OK — closed below on any failure; on success the connection's (freed on disconnect, as WebUsbTransport.open says)
            await next.transport.open();
            const id = await next.checkCompatible();
            const [version, cfg] = await Promise.all([next.readFirmwareVersion(), next.readConfig()]);
            // A board whose 0xEA can't be read still connects: offers fall back to its name.
            const fwIdentity = (await next.readFirmwareIdentity().catch(logged("reading the board's firmware identity (0xEA; update offers fall back to the board's name)"))) ?? null;
            const normalized = normalizeConfig(cfg);
            clientRef.current = next; // at once: the caller may use it before the next render (a switch's identify)
            setClient(next);
            setIdentity(id);
            setFirmwareIdentity(fwIdentity);
            setFirmwareVersion(version);
            setConfig(normalized);
            // Flash holds this only if the dongle says nothing is unsaved (older
            // firmware can't say: assume it does, as before).
            setSavedConfig(id.unsaved ? null : normalized);
            setDraft(normalized);
            setSaveState("idle");
            setError(null);
            setBusy(null);
            currentKeyRef.current = key;
            setCurrentKey(key);
            rememberBoard({ boardId: id.boardId, serial: transport.serial ?? null });
            const back = expectRef.current;
            if (back && back.id === rememberKey({ boardId: id.boardId, serial: transport.serial ?? null })) expectRef.current = null;
            return true;
          } catch (cause) {
            // error: SHOWN — desktop.boardBusy.* (BoardBusyNotice: what holds it where known, Retry, and it connects by itself once free), else the keyed USB/board errors below
            // Let go of the half-open device whatever went wrong, so this app
            // doesn't keep it claimed (another program, or the next try, can open it).
            await transport.close().catch(logged("closing the board after a failed connect (it's opened again on the next try)"));
            if (attempt === 0 && isPassingConnectError(cause)) {
              await new Promise<void>((resolve) => {
                // lifetime: OK — fires once (the pause before the one retry)
                setTimeout(resolve, CONNECT_RETRY_MS);
              });
              continue;
            }
            const platform = window.desktop?.platform;
            if (isBoardBusy(cause, platform)) {
              setError(null);
              const first = !busyRef.current;
              setBusy((prev) => prev ?? { holders: [] });
              if (first) lookUpHolders();
              return false;
            }
            // error: SHOWN — desktop.errors.usb.network and the other keyed USB/board errors (causeText) in the error notice (bridge.error); on Windows an open failure is desktop.windowsUsb.seen on the setup screen instead
            // Windows: a dongle Windows won't let us open (no WinUSB driver, or it
            // vanished during Repair USB driver). The setup screen explains that
            // and offers the repair (WindowsUsbRepair.tsx); the raw error helps no one.
            if (!(platform === "win32" && isOpenFailure(cause))) setError(causeText(cause));
            return false;
          }
        }
      } finally {
        if (!quiet) setOperation(null);
      }
    },
    [expectBack, lookUpHolders],
  );

  // Every board on USB (useful with any number of them). The board stack in
  // the rail shows them; one is on screen. Board operations (listing,
  // reading the others, switching) run one at a time: reading a board opens
  // and lets go of its USB device, which must never overlap a connect to it.
  // cache: OK — key=the board entry key; invalidated=replaced on every list (connect/disconnect, the slow refresh, a switch); bound=the boards on USB
  const entriesRef = useRef<Map<string, BoardEntry>>(new Map());
  const [summaries, setSummaries] = useState<BoardSummary[]>([]);
  const boardOps = useRef<Promise<unknown>>(Promise.resolve());
  const serialized = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    // error: NOT-WORTH — a task runs after a failed one too; the failure already went to its own caller
    const run = boardOps.current.then(task, task);
    // error: NOT-WORTH — the queue's own copy; the caller gets \`run\` with the error
    boardOps.current = run.catch(() => undefined);
    return run;
  }, []);
  const busyCause = useCallback((cause: unknown) => isBoardBusy(cause, window.desktop?.platform), []);

  // The list again, and a read of every board but the one on screen.
  const refreshBoards = useCallback(
    () =>
      serialized(async () => {
        const entries = await listBoards();
        entriesRef.current = new Map(entries.map((e) => [e.key, e]));
        const current = currentKeyRef.current;
        // loop: NOT-WORTH — N = boards on USB; once per refresh
        const others = entries.filter((e) => e.key !== current);
        const read = others.length > 0 && entries.length > 1 ? await readSummaries(others, busyCause) : [];
        const byKey = new Map(read.map((r) => [r.key, r]));
        // loop: NOT-WORTH — N = boards on USB; once per refresh
        setSummaries(entries.map((e) => byKey.get(e.key) ?? summaryOf(e, null, null, null)));
      }),
    [busyCause, serialized],
  );

  // Desktop: the main process has already granted the boards, so this
  // connects with no prompt. With several, the last one used (by its board
  // id) if it is there, else the first; while a board is expected back
  // (after its BOOTSEL, reboot or USB reconnect) only that one. Dev builds
  // can add simulated boards (Developer card).
  const autoConnect = useCallback(
    (quiet = false): Promise<void> =>
      serialized(async () => {
        if (clientRef.current) return;
        const entries = await listBoards();
        entriesRef.current = new Map(entries.map((e) => [e.key, e]));
        if (entries.length === 0) {
          setSummaries([]);
          setBusy(null); // unplugged meanwhile: nothing holds it any more
          return;
        }
        let pick = entries[0];
        const several = entries.length > 1;
        if (several) {
          const read = await readSummaries(entries, busyCause);
          setSummaries(read);
          const back = expectRef.current;
          if (back && Date.now() < back.until) {
            // loop: NOT-WORTH — N = boards on USB; once per connect
            const at = read.findIndex((r) => rememberKey(r) === back.id);
            if (at < 0) return; // not back yet: its own USB event (or the deadline) tries again
            pick = entries[at];
          } else {
            expectRef.current = null;
            pick = entries[pickBoard(read, lastBoardId())];
          }
        } else setSummaries([summaryOf(pick, null, null, null)]);
        const ok = await attachTransport(entryTransport(pick), quiet, pick.key);
        // With several boards, the one now on screen says so on its OLED.
        const c = clientRef.current as Ds5BridgeClient | null; // set by attachTransport meanwhile
        if (ok && several && c?.identifies) await c.identify().catch(logged("flashing the board's identify screen after connecting (the rail's stack shows which board is in use)"));
      }),
    [attachTransport, busyCause, serialized],
  );

  // A board picked in the stack: the board on screen just flashes its "THIS
  // ONE" screen; another one runs `other` (one board operation at a time).
  const onBoardPicked = useCallback(
    async (key: string, other: (entry: BoardEntry) => Promise<void>) => {
      if (key === currentKeyRef.current) {
        // error: SHOWN — desktop.errors.board.noIdentify and the board errors (causeText) in the error notice
        await clientRef.current?.identify().catch((cause: unknown) => setError(causeText(cause)));
        return;
      }
      await serialized(async () => {
        const entry = entriesRef.current.get(key);
        if (entry) await other(entry);
      });
    },
    [serialized],
  );

  // Show another board: let go of this one, connect that one, flash it.
  const selectBoard = useCallback(
    async (key: string) => {
      await onBoardPicked(key, async (entry) => {
        const prev = clientRef.current;
        clientRef.current = null;
        detach();
        if (prev && !(prev.transport instanceof SimulatedDongle)) await prev.transport.close();
        expectRef.current = null;
        const ok = await attachTransport(entryTransport(entry), false, entry.key);
        const c = clientRef.current as Ds5BridgeClient | null; // set by attachTransport meanwhile
        if (ok && c?.identifies) await c.identify().catch(logged("flashing the identify screen of the board just switched to (the rail shows it as in use)"));
      });
      await refreshBoards();
    },
    [attachTransport, detach, onBoardPicked, refreshBoards],
  );

  // Flash a board's "THIS ONE" screen without switching to it.
  const identifyBoard = useCallback(
    (key: string) =>
      onBoardPicked(key, async (entry) => {
        const transport = entryTransport(entry);
        try {
          // lifetime: OK — closed in the finally below
          await transport.open();
          const c = new Ds5BridgeClient(transport);
          await c.identity();
          await c.identify();
        } catch (cause) {
          // error: SHOWN — desktop.errors.board.noIdentify / the board errors (causeText) in the error notice
          setError(causeText(cause));
        } finally {
          if (entry.kind === "usb") await transport.close();
        }
      }),
    [onBoardPicked],
  );

  // Retry now (the notice's button): names the holder again too.
  const retryBusy = useCallback(async () => {
    await autoConnect(true);
    if (busyRef.current) lookUpHolders();
  }, [autoConnect, lookUpHolders]);

  const isBusy = busy !== null;
  // While another program holds the board, try again every BUSY_RETRY_MS, so
  // it connects by itself once that program lets go (no USB event says so).
  // lifetime: OK — cleanup: clears the retry timer (connected, unplugged, unmount)
  useEffect(() => {
    if (!isBusy) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      // error: NOT-WORTH — a failed try keeps the busy notice up (attachTransport's catch); this only keeps a bug from being unhandled
      autoConnect(true)
        .catch(logged("trying the board again while another program held it"))
        .finally(() => {
          // lifetime: OK — self re-arming while busy; cleared in the cleanup
          if (!stopped && busyRef.current) timer = setTimeout(tick, BUSY_RETRY_MS);
        });
    };
    // lifetime: OK — the first retry; cleared in the cleanup
    timer = setTimeout(tick, BUSY_RETRY_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [autoConnect, isBusy]);

  const connect = useCallback(async () => {
    try {
      await attachTransport(new WebUsbTransport(await WebUsbTransport.request()));
    } catch (cause) {
      // error: SHOWN — desktop.errors.usb.security and the other keyed USB/board errors (causeText) in the error notice (bridge.error); NotFoundError is the user closing the device picker, not an error
      if (!(cause instanceof DOMException && cause.name === "NotFoundError")) setError(causeText(cause));
    }
  }, [attachTransport]);

  // What a successful apply, revert or save did to the board's unsaved flag
  // (identity [19]: RAM differs from flash), set here at once: the 1 s poll
  // alone left the save bar a second behind. Firmware without the flag: nothing.
  // A poll read that was on its way meanwhile is dropped (unsavedSetRef).
  const unsavedSetRef = useRef(0);
  const setUnsaved = useCallback((unsaved: boolean) => {
    unsavedSetRef.current++;
    setIdentity((prev) => (prev && prev.unsaved !== null && prev.unsaved !== unsaved ? { ...prev, unsaved } : prev));
  }, []);

  const run = useCallback(async (op: Exclude<Operation, null>, task: (c: Ds5BridgeClient) => Promise<void>): Promise<boolean> => {
    const c = clientRef.current;
    if (!c) return false;
    setOperation(op);
    try {
      await task(c);
      setError(null);
      return true;
    } catch (cause) {
      // error: SHOWN — desktop.errors.board.timeout and the other keyed USB/board errors (causeText) in the error notice (bridge.error), and the caller gets false
      setError(causeText(cause));
      return false;
    } finally {
      setOperation(null);
    }
  }, []);

  const readConfig = useCallback(
    () =>
      run("reading", async (c) => {
        const next = normalizeConfig(await c.readConfig());
        setConfig(next);
        setDraft(next);
        setSaveState("idle");
      }),
    [run],
  );

  const applyConfig = useCallback(async (): Promise<boolean> => {
    if (issues.length > 0) return false;
    return run("applying", async (c) => {
      const sent = draft;
      const normalized = normalizeConfig(sent);
      await c.applyConfig(normalized);
      setConfig(normalized);
      setUnsaved(!savedConfig || !configsEqual(normalized, savedConfig));
      // Edits made while this was on its way stay (and get applied next).
      setDraft((current) => (current === sent ? normalized : current));
      setSaveState("applied");
    });
  }, [draft, issues.length, run, savedConfig, setUnsaved]);

  const saveToFlash = useCallback(async (): Promise<boolean> => {
    if (isDirty) return false;
    return run("saving", async (c) => {
      await c.saveToFlash();
      setSavedConfig(config);
      setUnsaved(false);
      setSaveState("saved");
    });
  }, [config, isDirty, run, setUnsaved]);

  const revertToSaved = useCallback(async () => {
    if (!savedConfig) return;
    await run("applying", async (c) => {
      await c.applyConfig(savedConfig);
      setConfig(savedConfig);
      setUnsaved(false);
      setDraft(savedConfig);
      setSaveState("idle");
    });
  }, [run, savedConfig, setUnsaved]);

  const applyBody = useCallback(
    (body: ConfigBody) =>
      run("applying", async (c) => {
        const normalized = normalizeConfig(body);
        await c.applyConfig(normalized);
        setConfig(normalized);
        setUnsaved(!savedConfig || !configsEqual(normalized, savedConfig));
        setDraft(normalized);
        setSaveState("applied");
      }),
    [run, savedConfig, setUnsaved],
  );

  const reconnectUsb = useCallback(() => run("reconnecting", (c) => c.reconnectUsb()), [run]);

  const setPowerFlags = useCallback(
    (bits: number) =>
      run("saving", async (c) => {
        await c.setPowerFlags(bits);
        const id = await c.identity();
        setIdentity((prev) => (sameIdentity(prev, id) ? prev : id));
      }),
    [run],
  );

  const pressOledKey = useCallback((key: 0 | 1, long: boolean) => run("applying", (c) => c.pressOledKey(key, long)), [run]);
  const pressOledPad = useCallback((button: OledPadButton, holdMs?: number) => run("applying", (c) => c.pressOledPad(button, holdMs)), [run]);

  const setDraftField = useCallback(<Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaveState("dirty");
  }, []);

  const resetDraft = useCallback(() => {
    if (config) {
      setDraft(config);
      setSaveState("idle");
    }
  }, [config]);

  // lifetime: OK — acquires nothing (one auto-connect attempt)
  useEffect(() => {
    void autoConnect().catch(logged("connecting to an already-permitted board at start (without one, the setup screen shows)"));
  }, [autoConnect]);

  // Keep up with the dongle: its identity every second (unsaved flag, slot,
  // last command), and every other second its settings, so a change made on
  // the OLED (or a slot switch) shows here and isn't overwritten by the next
  // edit from the app. Skipped while the app has edits of its own on the way.
  const isDirtyRef = useRef(isDirty);
  const operationRef = useRef(operation);
  const configRef = useRef(config);
  // lifetime: OK — acquires nothing (mirrors state into refs)
  useEffect(() => {
    isDirtyRef.current = isDirty;
    operationRef.current = operation;
    configRef.current = config;
  });
  // lifetime: OK — cleanup: stops the 1 s identity / config poll (client change / unmount)
  useEffect(() => {
    if (!client) return;
    let stopped = false;
    let tick = 0;
    // When an identity was last taken, and the lightbar the last poll read
    // (takeIdentity: hidden, a lightbar that keeps changing waits).
    let takenAt = 0;
    let lastLightbar: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        if (!operationRef.current) {
          const unsavedSet = unsavedSetRef.current;
          const id = await client.identity();
          const now = Date.now();
          const lightbar = String(id.lightbar);
          const steady = lightbar === lastLightbar;
          lastLightbar = lightbar;
          // An apply or save that finished meanwhile set the unsaved flag itself; this read may predate it.
          if (!stopped && unsavedSet === unsavedSetRef.current)
            setIdentity((prev) => {
              if (!takeIdentity(prev, id, isWindowShown(), steady, takenAt, now)) return prev;
              takenAt = now;
              return id;
            });
          // Saved by something else (a slot switch, the OLED): flash = RAM now.
          if (!stopped && id.unsaved === false && !isDirtyRef.current) setSavedConfig(configRef.current);
          if (++tick % 2 === 0 && !isDirtyRef.current && !operationRef.current) {
            const next = normalizeConfig(await client.readConfig());
            if (!stopped && !isDirtyRef.current && !operationRef.current && !configsEqual(next, configRef.current)) {
              setConfig(next);
              setDraft(next);
            }
          }
        }
      } catch {
        // error: NOT-WORTH — gone or busy: the USB events handle reconnecting
      }
      // lifetime: OK — self re-arming 1 s poll, runs hidden on purpose (tray); cleared in the cleanup
      if (!stopped) timer = setTimeout(next, 1000);
    };
    // poll() catches its own errors; this only keeps a bug from being unhandled.
    const next = () => void poll().catch(logged("the board's identity/settings poll"));
    // lifetime: OK — the first tick; cleared in the cleanup
    timer = setTimeout(next, 1000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [client]);

  // Reboot, BOOTSEL + flash, USB reconnect and replugging all re-enumerate the
  // dongle: drop the old handle and pick the new one up automatically.
  // lifetime: OK — cleanup: removes both USB connect / disconnect listeners
  useEffect(() => {
    if (!supported) return;
    const onDisconnect = (event: USBConnectionEvent) => {
      const current = clientRef.current?.transport;
      const wasCurrent = current instanceof WebUsbTransport && current.device === event.device;
      if (wasCurrent) {
        clientRef.current = null;
        currentKeyRef.current = null;
        setCurrentKey(null);
        detach();
      }
      if (isDongle(event.device)) {
        setBusy(null);
        // Another board may be there: show it (unless this one is expected back), else just list again.
        (wasCurrent ? autoConnect() : refreshBoards()).catch(logged("listing the boards after one left USB (the stack keeps the last list)"));
      }
    };
    const onConnect = (event: USBConnectionEvent) => {
      if (isDongle(event.device)) autoConnect().catch(logged("connecting to a board that was plugged in (it stays on the setup screen)"));
    };
    // lifetime: OK — removed in the effect cleanup
    navigator.usb.addEventListener("disconnect", onDisconnect);
    // lifetime: OK — removed in the effect cleanup
    navigator.usb.addEventListener("connect", onConnect);
    return () => {
      navigator.usb.removeEventListener("disconnect", onDisconnect);
      navigator.usb.removeEventListener("connect", onConnect);
    };
  }, [autoConnect, detach, refreshBoards, supported]);

  // The simulated board (dev builds) re-enumerates the same way: BOOTSEL and
  // a firmware update take it off "USB" and bring it back running the new version.
  // lifetime: OK — cleanup: the simulated board's unsubscribe (unmount)
  useEffect(() => {
    const sim = simulatedBoard();
    if (!sim) return;
    // lifetime: OK — the effect returns its unsubscribe
    return sim.onChange(() => {
      const current = clientRef.current?.transport;
      // Only the first simulated board re-enumerates (the extra ones never leave).
      if (current instanceof SimulatedDongle && currentKeyRef.current === "sim-0" && current !== sim.dongle()) {
        clientRef.current = null; // gone now: the reconnect below must not wait for the next render
        currentKeyRef.current = null;
        setCurrentKey(null);
        detach();
      }
      if (sim.state !== "dongle") setBusy(null); // off USB: nothing holds it any more
      if (sim.state === "dongle") autoConnect().catch(logged("connecting to the simulated board after it restarted (it stays on the setup screen)"));
      else refreshBoards().catch(logged("listing the boards after the simulated one left (the stack keeps the last list)"));
    });
  }, [autoConnect, detach, refreshBoards]);

  // With several boards, the ones not on screen are read again every
  // OTHER_BOARDS_MS while the window is shown (their controller, slot,
  // version); hidden, nothing (the tray shows only the board in use).
  const several = summaries.length > 1;
  // lifetime: OK — cleanup: clears the slow refresh timer (fewer boards, client change, unmount)
  useEffect(() => {
    if (!several || !client) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const again = () => {
        // lifetime: OK — self re-arming every OTHER_BOARDS_MS; cleared in the cleanup
        if (!stopped) timer = setTimeout(tick, OTHER_BOARDS_MS);
      };
      if (!isWindowShown()) return again();
      refreshBoards().catch(logged("reading the other boards (their rows keep the last read)")).finally(again);
    };
    // lifetime: OK — the first refresh; cleared in the cleanup
    timer = setTimeout(tick, OTHER_BOARDS_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [several, client, refreshBoards]);

  // A board expected back that never came (a failed update, unplugged on the
  // way): at its deadline, show whichever board is there.
  // lifetime: OK — cleanup: clears the deadline timer (connected again, unmount)
  useEffect(() => {
    if (client) return;
    const back = expectRef.current;
    if (!back) return;
    // lifetime: OK — fires once at the deadline; cleared in the cleanup
    const timer = setTimeout(
      () => {
        expectRef.current = null;
        autoConnect().catch(logged("connecting to another board after the expected one didn't come back (the setup screen stays)"));
      },
      Math.max(0, back.until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [client, autoConnect]);

  return {
    supported,
    client,
    identity,
    firmwareIdentity,
    firmwareVersion,
    deviceLabel,
    config,
    savedConfig,
    hasUnsavedChanges: identity?.unsaved ?? !configsEqual(config, savedConfig),
    canRevert: !!savedConfig && !configsEqual(config, savedConfig),
    draft,
    issues,
    saveState,
    operation,
    error,
    statusText,
    isConnected,
    isDirty,
    setDraftField,
    connect,
    readConfig,
    applyConfig,
    saveToFlash,
    reconnectUsb,
    setPowerFlags,
    supportsOledKeys: supportsFeature3(identity, 18, FEATURES3.oledKeys),
    pressOledKey,
    supportsOledPad: supportsFeature3(identity, 19, FEATURES3.oledPad),
    pressOledPad,
    resetDraft,
    revertToSaved,
    applyBody,
    clearError: () => setError(null),
    busy,
    retryBusy,
    // loop: HOT-PATH-OK — N = boards on USB (up to ~20), a shallow copy per render of the hook
    boards: summaries.map((s) => (s.key === currentKey ? summaryOf(s, identity, client?.transport.serial ?? null, firmwareVersion) : s)),
    currentBoard: currentKey,
    selectBoard,
    identifyBoard,
  };
}
