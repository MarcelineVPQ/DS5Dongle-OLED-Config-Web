// App settings → Dismissed notices: the dismissed notices that still apply
// (an update not installed yet, a board problem still there), each with the
// place to act on it and Show again. Dismissals whose reason is gone are
// pruned (DesktopApp), so they never show here. The section's body; its
// status counts them (useDismissedTasks).
import { useTranslation } from "react-i18next";
import { railLabel } from "./AppRail";
import { restoreNotices, useDismissedNotices, useNoticeTasks, type NoticeTask } from "./notices";

// The open tasks whose notice was dismissed.
export function useDismissedTasks(): NoticeTask[] {
  const { tasks } = useNoticeTasks();
  const dismissed = useDismissedNotices();
  // loop: NOT-WORTH — N ≤ ~6 open tasks; App settings' render
  return tasks.filter((task) => task.key !== undefined && dismissed.has(task.key));
}

export default function DismissedNotices({ device }: { device: string }) {
  const { t } = useTranslation();
  const { goTo } = useNoticeTasks();
  const rows = useDismissedTasks();
  if (rows.length === 0) return <p className="dk-hint">{t("desktop.notices.none")}</p>;
  return (
    <>
      {/* loop: NOT-WORTH — N ≤ ~6 rows; App settings' render */}
      {rows.map((task) => {
        const place = railLabel(t, task.place, device);
        return (
          <div key={task.key} className="dk-row stack dk-dismissed">
            <span>{task.text}</span>
            <span className="dk-dismissed-acts">
              {/* Not for App settings itself: it's already open, unless the task has its own section here. */}
              {(task.place !== "app" || task.section) && (
                <button type="button" className="dk-btn" title={t("desktop.notices.goTo", { place })} onClick={() => goTo(task.place, task.section)}>
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
  );
}
