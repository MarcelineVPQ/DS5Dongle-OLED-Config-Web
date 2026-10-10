import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type BridgeIdentity, Ds5BridgeClient } from "../protocol/bridgeClient";
import { ConfigBody, DEFAULT_CONFIG, ConfigValidationIssue, configsEqual, normalizeConfig, validateConfig } from "../protocol/config";
import { Ds5BridgeHidClient, webHidAvailable } from "../protocol/ds5BridgeHid";
import { WebUsbTransport, isDongle, webUsbAvailable } from "../protocol/webUsbTransport";

type Operation = "connecting" | "reading" | "applying" | "saving" | "reconnecting" | null;
type SaveState = "idle" | "dirty" | "applied" | "saved";

export interface UseDs5BridgeResult {
  supported: boolean;
  client: Ds5BridgeClient | null;
  identity: BridgeIdentity | null;
  firmwareVersion: string | null;
  deviceLabel: string;
  config: ConfigBody | null;
  // What the dongle has in flash, as far as this app knows: the config read at
  // connect, updated on every successful save.
  savedConfig: ConfigBody | null;
  hasUnsavedChanges: boolean;
  draft: ConfigBody;
  issues: ConfigValidationIssue[];
  saveState: SaveState;
  operation: Operation;
  error: string | null;
  statusText: string;
  isConnected: boolean;
  isDirty: boolean;
  setDraftField: <Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => void;
  connect: () => Promise<void>;
  readConfig: () => Promise<void>;
  applyConfig: () => Promise<void>;
  saveToFlash: () => Promise<void>;
  reconnectUsb: () => Promise<void>;
  resetDraft: () => void;
  // Put the dongle back to savedConfig (RAM only; flash already holds it).
  revertToSaved: () => Promise<void>;
  clearError: () => void;
  // Live input preview over the gamepad HID interface (browser WebHID only).
  hidClient: Ds5BridgeHidClient | null;
  hidSupported: boolean;
  connectPreview: () => Promise<void>;
}

export function useDs5Bridge(): UseDs5BridgeResult {
  const { t } = useTranslation();
  const supported = webUsbAvailable();
  const [client, setClient] = useState<Ds5BridgeClient | null>(null);
  const [identity, setIdentity] = useState<BridgeIdentity | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigBody | null>(null);
  const [savedConfig, setSavedConfig] = useState<ConfigBody | null>(null);
  const [draft, setDraft] = useState<ConfigBody>(DEFAULT_CONFIG);
  const [operation, setOperation] = useState<Operation>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hidClient, setHidClient] = useState<Ds5BridgeHidClient | null>(null);
  const clientRef = useRef<Ds5BridgeClient | null>(null);
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
    setFirmwareVersion(null);
    setConfig(null);
    setSavedConfig(null);
    setDraft(DEFAULT_CONFIG);
    setSaveState("idle");
  }, []);

  const attach = useCallback(async (device: USBDevice) => {
    setOperation("connecting");
    try {
      const next = new Ds5BridgeClient(new WebUsbTransport(device));
      await next.transport.open();
      const id = await next.checkCompatible();
      const [version, cfg] = await Promise.all([next.readFirmwareVersion(), next.readConfig()]);
      const normalized = normalizeConfig(cfg);
      setClient(next);
      setIdentity(id);
      setFirmwareVersion(version);
      setConfig(normalized);
      setSavedConfig(normalized);
      setDraft(normalized);
      setSaveState("idle");
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperation(null);
    }
  }, []);

  // Desktop: the main process has already granted the dongle, so this connects
  // with no prompt. Browser: works once the user has picked the dongle before.
  const autoConnect = useCallback(async () => {
    if (!supported || clientRef.current) return;
    const device = await WebUsbTransport.findPermitted();
    if (device) await attach(device);
  }, [attach, supported]);

  const connect = useCallback(async () => {
    try {
      await attach(await WebUsbTransport.request());
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "NotFoundError")) setError(errorMessage(cause));
    }
  }, [attach]);

  const run = useCallback(async (op: Exclude<Operation, null>, task: (c: Ds5BridgeClient) => Promise<void>) => {
    const c = clientRef.current;
    if (!c) return;
    setOperation(op);
    try {
      await task(c);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
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

  const applyConfig = useCallback(async () => {
    if (issues.length > 0) return;
    await run("applying", async (c) => {
      const normalized = normalizeConfig(draft);
      await c.applyConfig(normalized);
      setConfig(normalized);
      setDraft(normalized);
      setSaveState("applied");
    });
  }, [draft, issues.length, run]);

  const saveToFlash = useCallback(async () => {
    if (isDirty) return;
    await run("saving", async (c) => {
      await c.saveToFlash();
      setSavedConfig(config);
      setSaveState("saved");
    });
  }, [config, isDirty, run]);

  const revertToSaved = useCallback(async () => {
    if (!savedConfig) return;
    await run("applying", async (c) => {
      await c.applyConfig(savedConfig);
      setConfig(savedConfig);
      setDraft(savedConfig);
      setSaveState("idle");
    });
  }, [run, savedConfig]);

  const reconnectUsb = useCallback(() => run("reconnecting", (c) => c.reconnectUsb()), [run]);

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

  const connectPreview = useCallback(async () => {
    try {
      const next = await Ds5BridgeHidClient.requestDevice();
      await next.open();
      setHidClient(next);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void autoConnect();
  }, [autoConnect]);

  // Reboot, BOOTSEL + flash, USB reconnect and replugging all re-enumerate the
  // dongle: drop the old handle and pick the new one up automatically.
  useEffect(() => {
    if (!supported) return;
    const onDisconnect = (event: USBConnectionEvent) => {
      const current = clientRef.current?.transport;
      if (current instanceof WebUsbTransport && current.device === event.device) detach();
    };
    const onConnect = (event: USBConnectionEvent) => {
      if (isDongle(event.device)) void autoConnect();
    };
    navigator.usb.addEventListener("disconnect", onDisconnect);
    navigator.usb.addEventListener("connect", onConnect);
    return () => {
      navigator.usb.removeEventListener("disconnect", onDisconnect);
      navigator.usb.removeEventListener("connect", onConnect);
    };
  }, [autoConnect, detach, supported]);

  return {
    supported,
    client,
    identity,
    firmwareVersion,
    deviceLabel,
    config,
    savedConfig,
    hasUnsavedChanges: !configsEqual(config, savedConfig),
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
    resetDraft,
    revertToSaved,
    clearError: () => setError(null),
    hidClient,
    hidSupported: webHidAvailable(),
    connectPreview,
  };
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return "Unexpected USB error";
}
