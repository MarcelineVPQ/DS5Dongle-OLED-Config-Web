import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";

// Same order as the OLED Trigger Test screen (firmware oled.cpp kTrigPresetNames).
const PRESETS = ["Off", "Feedback", "Weapon", "Vibration", "Bow", "Gallop", "Machine"] as const;

export default function TriggersPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Leaving the page turns the effect off again, like leaving the OLED screen.
  useEffect(
    () => () => {
      void client?.previewTrigger(0).catch(() => undefined);
    },
    [client],
  );

  const pick = async (preset: number) => {
    if (!client) return;
    setError(null);
    try {
      await client.previewTrigger(preset);
      setActive(preset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="dk-grid">
      <section className="dk-card" style={{ gridColumn: "1 / -1" }}>
        <h2>{t("desktop.triggers.title", "Adaptive trigger test")}</h2>
        <p className="dk-hint">{t("desktop.triggers.hint", "Pick an effect, then pull L2 and R2. Games override this as soon as they send their own trigger effects.")}</p>
        {error && <div className="dk-notice error">{error}</div>}
        <div className="dk-presets">
          {PRESETS.map((name, i) => (
            <button type="button" key={name} className={`dk-btn${active === i ? " on" : ""}`} aria-pressed={active === i} disabled={!client} onClick={() => void pick(i)}>
              {t(`desktop.triggers.presets.${name.toLowerCase()}`, name)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
