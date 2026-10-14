// App settings → Dismissed notices: the dismissed notices that still apply
// (an update not installed yet, a board problem still there), each with the
// place to act on it and Show again. Dismissals whose reason is gone are
// pruned (DesktopApp), so they never show here.
import { useTranslation } from "react-i18next";
import { railLabel } from "./AppRail";
import { restoreNotices, useDismissedNotices, useNoticeTasks } from "./notices";

export default function DismissedNotices({ device }: { device: string }) {
  const { t } = useTranslation();
  const { tasks, goTo } = useNoticeTasks();
  const dismissed = useDismissedNotices();
  // loop: NOT-WORTH — N ≤ ~6 open tasks; App settings' render
  const rows = tasks.filter((task) => task.key !== undefined && dismissed.has(task.key));
  return (
    <section className="dk-card">
      <h2>{t("desktop.notices.dismissedTitle")}</h2>
      {rows.length === 0 ? (
        <p className="dk-hint">{t("desktop.notices.none")}</p>
      ) : (
        <>
          {/* loop: NOT-WORTH — N ≤ ~6 rows; App settings' render */}
          {rows.map((task) => {
            const place = railLabel(t, task.place, device);
            return (
              <div key={task.key} className="dk-row stack dk-dismissed">
                <span>{task.text}</span>
                <span className="dk-dismissed-acts">
                  {/* Not for App settings itself: it's already open. */}
                  {task.place !== "app" && (
                    <button type="button" className="dk-btn" title={t("desktop.notices.goTo", { place })} onClick={() => goTo(task.place)}>
                      {place}
                    </button>
                  )}
                  <button type="button" className="dk-btn" onClick={() => restoreNotices([task.key!])}>
                    {t("desktop.notices.showAgain")}
                  </button>
                </span>
              </div>
            );
          })}
          <div className="dk-row-btns">
            <button type="button" className="dk-btn" onClick={() => restoreNotices("all")}>
              {t("desktop.notices.showAllAgain")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
