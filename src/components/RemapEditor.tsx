// Button-remap editor. Self-contained: takes the connected HID client, reads
// the remap table off the device (appended to the 0xF7 config report), lets the
// user reassign each physical button, and writes it back over 0xF6. The
// firmware persists to its own flash sector on write — there is no separate
// save-to-flash step, so "Apply remapping" is the commit.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RotateCcw, Send, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Ds5BridgeHidClient } from "../protocol/ds5BridgeHid";
import {
  REMAP_BUTTON_OPTIONS,
  REMAP_DISABLED,
  RemapState,
  identityTable,
  isIdentity,
  tablesEqual,
} from "../protocol/remap";

export interface RemapEditorProps {
  client: Ds5BridgeHidClient | null;
}

export default function RemapEditor({ client }: RemapEditorProps) {
  const { t } = useTranslation();
  const [device, setDevice] = useState<RemapState | null>(null);
  const [draft, setDraft] = useState<number[]>(identityTable);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = !!client?.device.opened;

  // Read the device's table whenever a client attaches; clear when it detaches.
  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setSupported(null);
      setDevice(null);
      setDraft(identityTable());
      setError(null);
      setApplied(false);
      return;
    }
    (async () => {
      try {
        const state = await client.readRemap();
        if (cancelled) return;
        if (!state) {
          setSupported(false);
          return;
        }
        setSupported(true);
        setDevice(state);
        setDraft(state.table.slice());
        setError(null);
        setApplied(false);
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const deviceTable = device?.table ?? identityTable();
  const isDirty = !tablesEqual(draft, deviceTable);
  const remappedCount = draft.reduce((n, target, source) => (target !== source ? n + 1 : n), 0);
  const editable = connected && supported === true && !busy;

  const setRow = useCallback((source: number, target: number) => {
    setDraft((current) => current.map((v, i) => (i === source ? target : v)));
    setApplied(false);
  }, []);

  const apply = useCallback(async () => {
    if (!client || !isDirty) return;
    setBusy(true);
    setError(null);
    try {
      const before = device?.revision ?? -1;
      await client.applyRemap(draft);
      const after = await client.readRemap();
      if (!after || !tablesEqual(after.table, draft) || after.revision === before) {
        throw new Error(t("remap.verifyFailed"));
      }
      setDevice(after);
      setDraft(after.table.slice());
      setApplied(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [client, device, draft, isDirty, t]);

  const resetToDefault = useCallback(() => {
    setDraft(identityTable());
    setApplied(false);
  }, []);

  const revert = useCallback(() => {
    setDraft(deviceTable.slice());
    setApplied(false);
  }, [deviceTable]);

  return (
    <>
      <p className="panel-blurb">{t("remap.blurb")}</p>

      {supported === false && (
        <div className="notice warning">
          <AlertCircle size={18} />
          <span>{t("remap.unsupported")}</span>
        </div>
      )}

      {!connected && supported !== false && (
        <p className="control-hint">{t("remap.connectHint")}</p>
      )}

      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {applied && !isDirty && (
        <div className="notice">
          <CheckCircle2 size={18} />
          <span>{t("remap.applied")}</span>
        </div>
      )}

      <div className="control-stack">
        {REMAP_BUTTON_OPTIONS.map((source) => {
          const target = draft[source.value];
          const changed = target !== source.value;
          return (
            <label className="control-row" key={source.value}>
              <strong>
                {source.label}
                {changed && <small>{t("remap.remappedTag")}</small>}
              </strong>
              <select
                value={target}
                disabled={!editable}
                onChange={(e) => setRow(source.value, Number(e.currentTarget.value))}
                aria-label={t("remap.rowAria", { button: source.label })}
              >
                <option value={source.value}>{t("remap.noChange")}</option>
                {REMAP_BUTTON_OPTIONS.filter((o) => o.value !== source.value).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value={REMAP_DISABLED}>{t("remap.disabled")}</option>
              </select>
            </label>
          );
        })}
      </div>

      <div className="action-stack remap-actions">
        <button
          type="button"
          className="button primary wide"
          onClick={apply}
          disabled={!editable || !isDirty}
          title={t("remap.applyTitle")}
        >
          <Send size={17} /> {t("remap.apply")}
        </button>
        <button
          type="button"
          className="button ghost wide"
          onClick={revert}
          disabled={!editable || !isDirty}
          title={t("remap.revertTitle")}
        >
          <Undo2 size={17} /> {t("remap.revert")}
        </button>
        <button
          type="button"
          className="button ghost wide"
          onClick={resetToDefault}
          disabled={!editable || isIdentity(draft)}
          title={t("remap.resetTitle")}
        >
          <RotateCcw size={17} /> {t("remap.reset")}
        </button>
      </div>

      {supported === true && (
        <p className="control-hint">
          {remappedCount === 0 ? t("remap.noneRemapped") : t("remap.countRemapped", { count: remappedCount })}
        </p>
      )}
    </>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected WebHID error";
}
