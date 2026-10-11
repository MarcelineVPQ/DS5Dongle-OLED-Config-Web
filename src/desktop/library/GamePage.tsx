// One game's page in the Games library, laid out like Steam's: the artwork
// (hero + logo), a stats bar, quick links, then frames in two columns. The
// game's controller profile comes first: what this game changes on the dongle.
// Community reviews and shared configs have their frames reserved (phase 2).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { Segmented, Slider, Toggle, Row, hexToRgb, rgbToHex } from "../controls";
import { LIGHTBAR_MODES } from "../pages/LightbarPage";
import { useMsg } from "../pages/GamesPage";
import type { GameEntry, GameInfo, GamesReport } from "../games/types";
import { FEEDBACK_TAGS, type GameRecord, type LibraryFile, type Mine, type ProfileSettings } from "../games/library";
import { fixesFor, staleness, supportOf, type FeatureState } from "./support";

export const artUrl = (key: string, kind: string) => `ds5-art://art/${encodeURIComponent(key)}/${kind}`;

interface Props {
  game: GameEntry;
  info: GameInfo | undefined;
  record: GameRecord | undefined;
  running: boolean;
  report: GamesReport;
  bridge: UseDs5BridgeResult;
  onLibrary: (file: LibraryFile) => void;
  onRescan: () => void;
}

export default function GamePage({ game, info, record, running, report, bridge, onLibrary, onRescan }: Props) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const support = supportOf(game);
  const has = (k: string) => info?.art.includes(k as never) ?? false;
  const jump = (id: string) => scroller.current?.querySelector(`#gp-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  // Scroll back to the top when another game is opened.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [game.key]);

  return (
    <div className="gp" ref={scroller}>
      <header className={`gp-hero${has("hero") ? "" : " plain"}`} style={has("hero") ? { backgroundImage: `url("${artUrl(game.key, "hero")}")` } : undefined}>
        {has("logo") ? <img className="gp-logo" src={artUrl(game.key, "logo")} alt={game.title} /> : <h1 className="gp-title">{game.title}</h1>}
      </header>

      <div className="gp-stats">
        <Stat
          label={running ? t("desktop.library.playing") : t("desktop.library.lastPlayed")}
          value={running ? `● ${t("desktop.library.running")}` : info?.lastPlayed ? new Date(info.lastPlayed * 1000).toLocaleDateString() : t("desktop.library.never")}
          accent={running}
        />
        <Stat label={t("desktop.library.playTime")} value={info?.playtimeMin ? hours(info.playtimeMin, t) : "—"} />
        <Stat
          label={t("desktop.library.runsWith")}
          value={`${game.runnerMissing || (!game.usesOurProton && support.features.triggers === "yes") ? "⚠ " : ""}${game.runner ?? t("desktop.library.launcherDefault")}`}
          onClick={() => jump("compat")}
        />
        <Stat label={t("desktop.library.dualsense")} value={`${TIER_ICON[support.tier]} ${t(`desktop.library.tier.${support.tier}`)}`} onClick={() => jump("support")} />
        {record?.mine?.rating && <Stat label={t("desktop.library.yourRating")} value={"★".repeat(record.mine.rating)} />}
      </div>

      <nav className="gp-jump" aria-label={t("desktop.library.jumpTo")}>
        {(["profile", "setup", "rating", "reviews", "configs", "compat", "support", "notes"] as const).map((id) => (
          <button key={id} type="button" className="dk-btn" onClick={() => jump(id)}>
            {t(`desktop.library.section.${id}`)}
          </button>
        ))}
      </nav>

      <div className="gp-cols">
        <div className="gp-col">
          <ProfileFrame game={game} record={record} running={running} bridge={bridge} onLibrary={onLibrary} />
          <SetupFrame game={game} onRescan={onRescan} />
          <RatingFrame game={game} info={info} record={record} onLibrary={onLibrary} />
          <section className="dk-card" id="gp-reviews">
            <h2>{t("desktop.library.section.reviews")}</h2>
            <p className="dk-hint">{t("desktop.library.reviewsSoon")}</p>
          </section>
          <section className="dk-card" id="gp-configs">
            <h2>{t("desktop.library.section.configs")}</h2>
            <p className="dk-hint">{t("desktop.library.configsSoon")}</p>
          </section>
        </div>
        <div className="gp-col">
          <CompatFrame game={game} report={report} onRescan={onRescan} />
          <SupportFrame game={game} />
          <NotesFrame game={game} info={info} record={record} onLibrary={onLibrary} />
          <DetailsFrame game={game} info={info} />
        </div>
      </div>
    </div>
  );
}

const TIER_ICON: Record<string, string> = { verified: "✓✓", works: "✓", "needs-setup": "⚙", partial: "◐", broken: "✗", unknown: "?" };
const FEATURE_ICON: Record<FeatureState, string> = { yes: "✓", no: "✗", unknown: "?" };

function hours(min: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  return min < 60 ? t("desktop.library.minutes", { count: min }) : t("desktop.library.hours", { count: Math.round(min / 6) / 10 });
}

function Stat({ label, value, accent, onClick }: { label: string; value: string; accent?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="gp-stat-label">{label}</span>
      <span className={`gp-stat-value${accent ? " dk-good" : ""}`} title={value}>
        {value}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="gp-stat link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="gp-stat">{body}</div>
  );
}

// ---- Controller profile ----
function settingsFrom(c: UseDs5BridgeResult["config"]): ProfileSettings | null {
  if (!c) return null;
  return {
    hapticsGain: c.hapticsGain,
    autoHapticsEnable: c.autoHapticsEnable,
    autoHapticsGain: c.autoHapticsGain,
    autoHapticsLowpass: c.autoHapticsLowpass,
    speakerVolume: c.speakerVolume,
    lightbarMode: c.lightbarMode,
    lbFavR: [...c.lbFavR],
    lbFavG: [...c.lbFavG],
    lbFavB: [...c.lbFavB],
    btMicEnable: c.btMicEnable,
  };
}

function ProfileFrame({ game, record, running, bridge, onLibrary }: { game: GameEntry; record?: GameRecord; running: boolean; bridge: UseDs5BridgeResult; onLibrary: (f: LibraryFile) => void }) {
  const { t } = useTranslation();
  const desktop = window.desktop!;
  const saved = record?.profile?.settings;
  const [draft, setDraft] = useState<ProfileSettings | null>(saved ?? null);
  useEffect(() => {
    setDraft(saved ?? null);
  }, [game.key, saved]);
  const current = settingsFrom(bridge.config);

  // Every edit is stored (debounced); applying it to the dongle while the
  // game runs is the profile hook's job.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const edit = (patch: Partial<ProfileSettings>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void desktop.librarySetProfile({ gameKey: game.key, title: game.title, settings: next }).then(onLibrary), 400);
  };
  const create = (from: ProfileSettings) => void desktop.librarySetProfile({ gameKey: game.key, title: game.title, settings: from }).then(onLibrary);

  return (
    <section className="dk-card" id="gp-profile">
      <h2>
        {t("desktop.library.section.profile")} {draft && running && <span className="dk-chip ok">{t("desktop.library.activeNow")}</span>}
      </h2>
      {!draft ? (
        <>
          <p className="dk-hint">{t("desktop.library.profileNone")}</p>
          <div className="dk-row-btns">
            <button type="button" className="dk-btn primary" disabled={!current} onClick={() => current && create(current)}>
              {t("desktop.library.profileFromCurrent")}
            </button>
          </div>
          {!current && <p className="dk-hint">{t("desktop.library.profileNeedsDongle")}</p>}
        </>
      ) : (
        <>
          <p className="dk-hint">{t("desktop.library.profileHint")}</p>
          <Slider label={t("desktop.library.haptics")} value={draft.hapticsGain} min={1} max={6} step={0.1} digits={1} unit="×" onChange={(v) => edit({ hapticsGain: v })} />
          <Segmented
            label={t("desktop.library.autoHaptics")}
            value={draft.autoHapticsEnable}
            options={(["off", "fallback", "mix", "replace"] as const).map((k, i) => ({ value: i, label: t(`desktop.library.autoMode.${k}`) }))}
            onChange={(v) => edit({ autoHapticsEnable: v })}
          />
          {draft.autoHapticsEnable > 0 && (
            <>
              <Slider label={t("desktop.library.autoGain")} value={draft.autoHapticsGain} min={0} max={200} step={5} unit="%" onChange={(v) => edit({ autoHapticsGain: v })} />
              <Segmented
                label={t("desktop.library.autoLowpass")}
                value={draft.autoHapticsLowpass}
                options={["80", "160", "250", "400"].map((hz, i) => ({ value: i, label: `${hz} Hz` }))}
                onChange={(v) => edit({ autoHapticsLowpass: v })}
              />
            </>
          )}
          <Slider label={t("desktop.library.speaker")} value={draft.speakerVolume} min={-30} max={12} step={1} unit="dB" signed onChange={(v) => edit({ speakerVolume: v })} />
          <Row label={t("desktop.library.lightbar")}>
            <select className="dk-select" value={draft.lightbarMode} onChange={(e) => edit({ lightbarMode: Number(e.target.value) })}>
              {LIGHTBAR_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {t(`desktop.lightbar.modes.${m.key}`, m.label)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("desktop.library.favorites")}>
            <div className="gp-favs">
              {[0, 1, 2, 3].map((i) => (
                <input
                  key={i}
                  type="color"
                  aria-label={`FAV${i}`}
                  title={`FAV${i}`}
                  value={rgbToHex([draft.lbFavR[i], draft.lbFavG[i], draft.lbFavB[i]])}
                  onChange={(e) => {
                    const [r, g, b] = hexToRgb(e.target.value);
                    const set = (a: number[], v: number) => a.map((x, j) => (j === i ? v : x));
                    edit({ lbFavR: set(draft.lbFavR, r), lbFavG: set(draft.lbFavG, g), lbFavB: set(draft.lbFavB, b) });
                  }}
                />
              ))}
            </div>
          </Row>
          <Toggle label={t("desktop.library.mic")} value={draft.btMicEnable} onChange={(v) => edit({ btMicEnable: v })} />
          <div className="dk-row-btns">
            <button type="button" className="dk-btn" disabled={!current} onClick={() => current && create(current)}>
              {t("desktop.library.profileCopyCurrent")}
            </button>
            <button type="button" className="dk-btn danger" onClick={() => void desktop.libraryDeleteProfile(game.key).then(onLibrary)}>
              {t("desktop.library.profileDelete")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ---- Setup (this game's recommended fixes) ----
function SetupFrame({ game, onRescan }: { game: GameEntry; onRescan: () => void }) {
  const { t } = useTranslation();
  const m = useMsg();
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setConfirm(false);
    setNote(null);
  }, [game.key]);
  const apply = async () => {
    setBusy(true);
    try {
      const r = await window.desktop!.gamesApply(game.fixes.map((f) => f.id));
      setNote(r.applied.length > 0 && r.applied.every((a) => a.ok) && r.blockedBy.length === 0 ? t("desktop.library.setupDone") : t("desktop.library.setupFailed"));
      onRescan();
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <section className="dk-card" id="gp-setup">
      <h2>{t("desktop.library.section.setup")}</h2>
      {game.fixes.length === 0 ? (
        <p className="dk-good">✓ {t("desktop.library.setupNone")}</p>
      ) : (
        <>
          <ul className="dk-review">
            {game.fixes.map((f) => (
              <li key={f.id}>
                <b>{m(f.label)}</b>
                <br />
                <span className="dk-hint">{m(f.why)}</span>
                {confirm && <span className="dk-hint dk-mono"> · {f.files.join(", ")}</span>}
              </li>
            ))}
          </ul>
          <div className="dk-row-btns">
            {!confirm ? (
              <button type="button" className="dk-btn primary" onClick={() => setConfirm(true)}>
                {t("desktop.library.setupReview")}
              </button>
            ) : (
              <>
                <button type="button" className="dk-btn" onClick={() => setConfirm(false)}>
                  {t("desktop.library.cancel")}
                </button>
                <button type="button" className="dk-btn primary" disabled={busy} onClick={() => void apply()}>
                  {t("desktop.library.setupApply")}
                </button>
              </>
            )}
          </div>
        </>
      )}
      {note && <p className="dk-hint">{note}</p>}
    </section>
  );
}

// ---- Compatibility (Proton) ----
function CompatFrame({ game, report, onRescan }: { game: GameEntry; report: GamesReport; onRescan: () => void }) {
  const { t } = useTranslation();
  const ours = report.ourProton.name;
  const runnerFix = game.fixes.find((f) => f.kind === "set-runner");
  const native = game.support === "triggers" || game.support === "haptics";
  const [busy, setBusy] = useState(false);
  return (
    <section className="dk-card" id="gp-compat">
      <h2>{t("desktop.library.section.compat")}</h2>
      <Row label={t("desktop.library.store")}>
        <span>{t(`desktop.library.storeName.${game.store}`)}</span>
      </Row>
      <Row label={t("desktop.library.runsWith")} invalid={game.runnerMissing} stack>
        <span className="dk-mono" title={game.runner ?? undefined}>
          {game.runnerMissing ? "⚠ " : ""}
          {game.runner ?? t("desktop.library.launcherDefault")}
        </span>
      </Row>
      <Row label={t("desktop.library.recommended")} stack>
        <span className="dk-mono">{native ? (ours ?? t("desktop.library.protonNotInstalled")) : t("desktop.library.anyProton")}</span>
      </Row>
      {game.usesOurProton ? (
        <p className="dk-good">✓ {t("desktop.library.usesOurs")}</p>
      ) : runnerFix ? (
        <div className="dk-row-btns">
          <button
            type="button"
            className="dk-btn primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void window
                .desktop!.gamesApply([runnerFix.id])
                .then(onRescan)
                .finally(() => setBusy(false));
            }}
          >
            {t("desktop.library.switchTo", { name: ours })}
          </button>
        </div>
      ) : null}
    </section>
  );
}

// ---- DualSense support ----
function SupportFrame({ game }: { game: GameEntry }) {
  const { t } = useTranslation();
  const s = supportOf(game);
  return (
    <section className="dk-card" id="gp-support">
      <h2>{t("desktop.library.section.support")}</h2>
      <p className={`gp-tier ${s.tier}`}>
        <b>
          {TIER_ICON[s.tier]} {t(`desktop.library.tier.${s.tier}`)}
        </b>
        <br />
        <span className="dk-hint">{t(`desktop.library.tierHint.${s.tier}`)}</span>
      </p>
      {fixesFor(game.title).length > 0 && (
        <ul className="dk-review">
          {fixesFor(game.title).map((f) => (
            <li key={f.app + f.note}>
              <b>{t("desktop.library.fixedIn", { version: f.app })}</b> {t(`desktop.library.fix.${f.note}`)}
            </li>
          ))}
        </ul>
      )}
      <ul className="gp-features">
        {(["triggers", "haptics", "speaker", "mic", "lightbar"] as const).map((f) => (
          <li key={f} title={t(`desktop.library.feature.${s.features[f]}`)}>
            <span aria-hidden="true">{FEATURE_ICON[s.features[f]]}</span> {t(`desktop.library.featureName.${f}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- The player's own rating and notes (local; sharing comes later) ----
function useMine(game: GameEntry, info: GameInfo | undefined, record: GameRecord | undefined, onLibrary: (f: LibraryFile) => void) {
  const [mine, setMine] = useState<Mine>(record?.mine ?? {});
  const app = window.desktop!.appVersion;
  useEffect(() => {
    setMine(record?.mine ?? {});
  }, [game.key, record?.mine]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = (patch: Partial<Mine>) => {
    // A rating or feedback change re-stamps what it was given on.
    const stamp = ("rating" in patch || "tags" in patch) && app ? { ratedOn: { app, build: info?.buildId, gameUpdated: info?.lastUpdated, at: Math.floor(Date.now() / 1000) } } : {};
    const next = { ...mine, ...patch, ...stamp };
    setMine(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void window.desktop!.librarySetMine({ gameKey: game.key, title: game.title, mine: next }).then(onLibrary), 500);
  };
  return [mine, update] as const;
}

function RatingFrame({ game, info, record, onLibrary }: { game: GameEntry; info?: GameInfo; record?: GameRecord; onLibrary: (f: LibraryFile) => void }) {
  const { t } = useTranslation();
  const [mine, update] = useMine(game, info, record, onLibrary);
  const stale = staleness(mine.ratedOn, info ?? {}, fixesFor(game.title));
  return (
    <section className="dk-card" id="gp-rating">
      <h2>{t("desktop.library.section.rating")}</h2>
      <div className="gp-stars" role="radiogroup" aria-label={t("desktop.library.section.rating")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={mine.rating === n}
            aria-label={t("desktop.library.stars", { count: n })}
            className={(mine.rating ?? 0) >= n ? "on" : ""}
            onClick={() => update({ rating: mine.rating === n ? undefined : n })}
          >
            {(mine.rating ?? 0) >= n ? "★" : "☆"}
          </button>
        ))}
      </div>
      {stale && (
        <p className="dk-notice">
          {stale.kind === "our-fix"
            ? t("desktop.library.staleFix", { version: stale.app })
            : stale.at
              ? t("desktop.library.staleUpdateOn", { date: new Date(stale.at * 1000).toLocaleDateString() })
              : t("desktop.library.staleUpdate")}{" "}
          <button type="button" className="dk-btn dk-inline-btn" onClick={() => update({ tags: mine.tags ?? [] })}>
            {t("desktop.library.stillAccurate")}
          </button>
        </p>
      )}
      <p className="dk-hint">{t("desktop.library.feedbackHint")}</p>
      <ul className="gp-tags">
        {FEEDBACK_TAGS.map((tag) => {
          const on = mine.tags?.includes(tag) ?? false;
          return (
            <li key={tag}>
              <label>
                <input type="checkbox" checked={on} onChange={() => update({ tags: on ? (mine.tags ?? []).filter((x) => x !== tag) : [...(mine.tags ?? []), tag] })} />{" "}
                {t(`desktop.library.tag.${tag}`)}
              </label>
            </li>
          );
        })}
      </ul>
      <p className="dk-hint">{t("desktop.library.shareSoon")}</p>
    </section>
  );
}

function NotesFrame({ game, info, record, onLibrary }: { game: GameEntry; info?: GameInfo; record?: GameRecord; onLibrary: (f: LibraryFile) => void }) {
  const { t } = useTranslation();
  const [mine, update] = useMine(game, info, record, onLibrary);
  return (
    <section className="dk-card" id="gp-notes">
      <h2>{t("desktop.library.section.notes")}</h2>
      <textarea className="dk-textarea" rows={4} maxLength={5000} placeholder={t("desktop.library.notesPlaceholder")} value={mine.notes ?? ""} onChange={(e) => update({ notes: e.target.value })} />
    </section>
  );
}

function DetailsFrame({ game, info }: { game: GameEntry; info?: GameInfo }) {
  const { t } = useTranslation();
  return (
    <section className="dk-card" id="gp-details">
      <h2>{t("desktop.library.section.details")}</h2>
      <dl className="live-data-rows">
        <div>
          <dt>{t("desktop.library.launcher")}</dt>
          <dd>{t(`desktop.library.launcherName.${game.launcher}`)}</dd>
        </div>
        <div>
          <dt>{t("desktop.library.id")}</dt>
          <dd className="dk-mono">{game.id}</dd>
        </div>
        {info?.sizeBytes && (
          <div>
            <dt>{t("desktop.library.size")}</dt>
            <dd>{(info.sizeBytes / 1e9).toFixed(1)} GB</dd>
          </div>
        )}
        {info?.lastUpdated && (
          <div>
            <dt>{t("desktop.library.updated")}</dt>
            <dd>{new Date(info.lastUpdated * 1000).toLocaleDateString()}</dd>
          </div>
        )}
      </dl>
      {info?.installDir && (
        <p className="dk-hint dk-mono gp-path" title={info.installDir}>
          {info.installDir}
        </p>
      )}
    </section>
  );
}
