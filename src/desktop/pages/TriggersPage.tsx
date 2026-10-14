import { useEffect, useState } from "react";
import { causeText } from "../shownError";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { logged } from "../../errorText";
import Notice from "../Notice";
import { SectionGroup } from "../accordion/Section";

// Same order as the OLED Trigger Test screen (firmware oled.cpp kTrigPresetNames).
const PRESETS = ["Off", "Feedback", "Weapon", "Vibration", "Bow", "Gallop", "Machine"] as const;

export default function TriggersPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  const { t } = useTranslation();
  const client = bridge.client;
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Folding the section (or leaving the page) turns the effect off again, like leaving the OLED screen.
  // lifetime: OK — acquires nothing; the cleanup turns the trigger preview off
  useEffect(
    () => () => {
      // error: NOT-WORTH — leaving the page; a failed "off" leaves the test effect until a game sends its own
      if (client) void client.previewTrigger(0).catch(() => undefined);
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
      // error: SHOWN — desktop.errors.boardFailed (causeText; other board errors English, batch E3)
      setError(causeText(cause));
    }
  };

  return (
    <SectionGroup title={t("desktop.triggers.title", "Adaptive trigger test")}>
      <p className="dk-hint">{t("desktop.triggers.hint", "Pick an effect, then pull L2 and R2. Games override this as soon as they send their own trigger effects.")}</p>
      {error && (
        <Notice error onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      <div className="dk-presets">
        {/* loop: HOT-PATH-OK — N = 7 presets; page render */}
        {PRESETS.map((name, i) => (
          <button
            type="button"
            key={name}
            className={`dk-btn${active === i ? " on" : ""}`}
            aria-pressed={active === i}
            disabled={!client}
            onClick={() => void pick(i).catch(logged("pick (it shows its own errors)"))}
          >
            {t(`desktop.triggers.presets.${name.toLowerCase()}`, name)}
          </button>
        ))}
      </div>
    </SectionGroup>
  );
}
