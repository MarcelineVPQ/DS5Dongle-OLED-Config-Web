// The board is plugged in but another program holds it (WebUSB's "Unable to
// claim interface"): who, where the main process can tell (Linux), else the
// usual suspects; on Windows also the driver, which looks the same from here.
// The app tries again by itself every few seconds (useDs5Bridge, BUSY_RETRY_MS)
// and the notice goes once it connects or the board is unplugged; Retry
// tries now.
import { useTranslation } from "react-i18next";
import Notice from "./Notice";
import { BusyButton } from "./controls";
import type { BoardHolder } from "./api";

export default function BoardBusyNotice({ busy, onRetry }: { busy: { holders: BoardHolder[] } | null; onRetry: () => Promise<void> }) {
  const { t } = useTranslation();
  if (!busy) return null;
  const windows = window.desktop?.platform === "win32";
  // loop: HOT-PATH-OK — at most 5 holders (MAX_HOLDERS), only while the board is busy
  const names = busy.holders.map((h) => (h.kind === "app" ? t("desktop.boardBusy.kind.app") : h.kind === "browser" ? t("desktop.boardBusy.kind.browser", { name: h.name }) : h.name));
  return (
    <Notice error role="alert" action={<BusyButton onClick={onRetry}>{t("desktop.boardBusy.retry")}</BusyButton>}>
      <span data-testid="board-busy">
        <strong>{t("desktop.boardBusy.title")}</strong> {names.length ? t("desktop.boardBusy.heldBy", { names: names.join(", ") }) : t("desktop.boardBusy.suspects")} {t("desktop.boardBusy.closeIt")}
        {windows && <> {t("desktop.boardBusy.windowsDriver")}</>}
      </span>
    </Notice>
  );
}
