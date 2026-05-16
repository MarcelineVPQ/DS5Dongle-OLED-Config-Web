import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ConfigBody,
  DEFAULT_CONFIG,
  ConfigValidationIssue,
  configsEqual,
  normalizeConfig,
  validateConfig,
} from "../protocol/config";
import { Ds5BridgeHidClient, getDeviceLabel, webHidAvailable } from "../protocol/ds5BridgeHid";

type Operation = "connecting" | "reading" | "applying" | "saving" | "reconnecting" | null;
type SaveState = "idle" | "dirty" | "applied" | "saved";

export interface UseDs5BridgeResult {
  supported: boolean;
  client: Ds5BridgeHidClient | null;
  deviceLabel: string;
  authorizedDevices: HIDDevice[];
  config: ConfigBody | null;
  draft: ConfigBody;
  issues: ConfigValidationIssue[];
  saveState: SaveState;
  operation: Operation;
  error: string | null;
  statusText: string;
  isConnected: boolean;
  isDirty: boolean;
  setDraftField: <Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => void;
  refreshAuthorizedDevices: () => Promise<void>;
  connect: () => Promise<void>;
  connectAuthorized: (device: HIDDevice) => Promise<void>;
  readConfig: () => Promise<void>;
  applyConfig: () => Promise<void>;
  saveToFlash: () => Promise<void>;
  reconnectUsb: () => Promise<void>;
  resetDraft: () => void;
  clearError: () => void;
}

export function useDs5Bridge(): UseDs5BridgeResult {
  const supported = webHidAvailable();
  const [client, setClient] = useState<Ds5BridgeHidClient | null>(null);
  const [authorizedDevices, setAuthorizedDevices] = useState<HIDDevice[]>([]);
  const [config, setConfig] = useState<ConfigBody | null>(null);
  const [draft, setDraft] = useState<ConfigBody>(DEFAULT_CONFIG);
  const [operation, setOperation] = useState<Operation>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const issues = useMemo(() => validateConfig(draft), [draft]);
  const isConnected = Boolean(client?.device.opened);
  const isDirty = !configsEqual(config, draft);
  const deviceLabel = getDeviceLabel(client?.device ?? null);

  const statusText = useMemo(() => {
    if (!supported) {
      return "WebHID unavailable";
    }
    if (operation) {
      return operationLabel(operation);
    }
    if (!client) {
      return "Ready to connect";
    }
    if (isDirty) {
      return "Unsaved edits";
    }
    if (saveState === "applied") {
      return "Applied to device";
    }
    if (saveState === "saved") {
      return "Saved to flash";
    }
    return "Connected";
  }, [client, isDirty, operation, saveState, supported]);

  const refreshAuthorizedDevices = useCallback(async () => {
    if (!supported) {
      setAuthorizedDevices([]);
      return;
    }

    setAuthorizedDevices(await Ds5BridgeHidClient.authorizedDevices());
  }, [supported]);

  const readConfigWithClient = useCallback(async (nextClient: Ds5BridgeHidClient) => {
    setOperation("reading");
    try {
      const nextConfig = normalizeConfig(await nextClient.readConfig());
      setConfig(nextConfig);
      setDraft(nextConfig);
      setSaveState("idle");
      setError(null);
    } finally {
      setOperation(null);
    }
  }, []);

  const attachClient = useCallback(
    async (nextClient: Ds5BridgeHidClient) => {
      setOperation("connecting");
      try {
        await nextClient.open();
        setClient(nextClient);
        setError(null);
      } finally {
        setOperation(null);
      }
      await readConfigWithClient(nextClient);
    },
    [readConfigWithClient],
  );

  const connect = useCallback(async () => {
    try {
      await attachClient(await Ds5BridgeHidClient.requestDevice());
      await refreshAuthorizedDevices();
    } catch (cause) {
      setError(errorMessage(cause));
      setOperation(null);
    }
  }, [attachClient, refreshAuthorizedDevices]);

  const connectAuthorized = useCallback(
    async (device: HIDDevice) => {
      try {
        await attachClient(new Ds5BridgeHidClient(device));
      } catch (cause) {
        setError(errorMessage(cause));
        setOperation(null);
      }
    },
    [attachClient],
  );

  const readConfig = useCallback(async () => {
    if (!client) {
      return;
    }

    try {
      await readConfigWithClient(client);
    } catch (cause) {
      setError(errorMessage(cause));
      setOperation(null);
    }
  }, [client, readConfigWithClient]);

  const applyConfig = useCallback(async () => {
    if (!client || issues.length > 0) {
      return;
    }

    setOperation("applying");
    try {
      const normalized = normalizeConfig(draft);
      await client.applyConfig(normalized);
      setConfig(normalized);
      setDraft(normalized);
      setSaveState("applied");
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [client, draft, issues.length]);

  const saveToFlash = useCallback(async () => {
    if (!client || isDirty) {
      return;
    }

    setOperation("saving");
    try {
      await client.saveToFlash();
      setSaveState("saved");
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [client, isDirty]);

  const reconnectUsb = useCallback(async () => {
    if (!client) {
      return;
    }

    setOperation("reconnecting");
    try {
      await client.reconnectUsb();
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [client]);

  const setDraftField = useCallback(
    <Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => {
      setDraft((current) => ({ ...current, [field]: value }));
      setSaveState("dirty");
    },
    [],
  );

  const resetDraft = useCallback(() => {
    if (config) {
      setDraft(config);
      setSaveState("idle");
    }
  }, [config]);

  useEffect(() => {
    void refreshAuthorizedDevices();
  }, [refreshAuthorizedDevices]);

  useEffect(() => {
    if (!navigator.hid) {
      return;
    }

    const handleDisconnect = (event: HIDConnectionEvent) => {
      if (client?.device === event.device) {
        setClient(null);
        setConfig(null);
        setDraft(DEFAULT_CONFIG);
        setSaveState("idle");
        setError("Device disconnected");
      }
      void refreshAuthorizedDevices();
    };

    const handleConnect = () => {
      void refreshAuthorizedDevices();
    };

    navigator.hid.addEventListener("disconnect", handleDisconnect);
    navigator.hid.addEventListener("connect", handleConnect);

    return () => {
      navigator.hid?.removeEventListener("disconnect", handleDisconnect);
      navigator.hid?.removeEventListener("connect", handleConnect);
    };
  }, [client, refreshAuthorizedDevices]);

  return {
    supported,
    client,
    deviceLabel,
    authorizedDevices,
    config,
    draft,
    issues,
    saveState,
    operation,
    error,
    statusText,
    isConnected,
    isDirty,
    setDraftField,
    refreshAuthorizedDevices,
    connect,
    connectAuthorized,
    readConfig,
    applyConfig,
    saveToFlash,
    reconnectUsb,
    resetDraft,
    clearError: () => setError(null),
  };
}

function operationLabel(operation: Exclude<Operation, null>): string {
  switch (operation) {
    case "connecting":
      return "Connecting";
    case "reading":
      return "Reading config";
    case "applying":
      return "Applying config";
    case "saving":
      return "Saving to flash";
    case "reconnecting":
      return "Reconnecting USB";
  }
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return "Unexpected WebHID error";
}
