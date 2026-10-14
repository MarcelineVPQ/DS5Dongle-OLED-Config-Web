// Developer card → Fake games (dev builds only, see index.ts): stands in for
// GamesService while the switch is on. Serves the made-up library from
// fake/library.ts and acts on it alone: Rescan answers from memory, Apply and
// Undo change the in-memory state, ▶ Play marks the game running for a minute,
// Install "downloads" our Proton with progress and nothing else. It never
// reads or writes a launcher's files, the home folder's Steam / Heroic /
// Lutris folders, or starts a program. Its own files live in one dev folder
// in userData: the generated art (drawn on first use, fake/art.ts) and a
// library file of its own (profiles, ratings and notes for the fake games),
// so the player's real library is never touched.
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtKind, ApplyResult, GameAction, GameInfo, GamesReport, LauncherId, RestartList } from "../../../../src/desktop/games/types";
import { FAKE_GAMES_HDR, type DevFakeGamesState, type GameBackup, type ProtonInstallResult, type ProtonProgress, type UndoResult } from "../../../../src/desktop/api";
import type { LibraryFile } from "../../../../src/desktop/games/library";
import { LibraryStore, LIBRARY_FILE } from "../libraryStore";
import { logged } from "../../../../src/errorText";
import { drawArt, hash32, type Bitmap } from "./art";
import { ART_SIZES, FAKE_GAMES, LATEST_PROTON, fakeApply, fakeBackups, fakeDetails, fakeKey, fakeReport, fakeUndo, newFakeState, type FakeHdr, type FakeState } from "./library";

export const PLAY_MS = 60_000; // ▶ Play: the game "runs" this long
const SCAN_MS = 400; // a scan takes a moment, so the page's loading states show
const ART_VERSION = "art-v1"; // bump when art.ts draws differently: the next start draws again

export interface FakeGamesDeps {
  dir: string; // userData/dev-fake-games
  platform: NodeJS.Platform;
  encode: (bitmap: Bitmap, png: boolean) => Buffer; // nativeImage (index.ts); tests pass their own
  colorOf: (file: string) => string | null; // artColor.ts dominantColor
  onRunning: (key: string | null) => void; // the page's running-game event
  onProtonProgress: (p: ProtonProgress) => void;
  layouts?: () => LibraryFile["layouts"]; // the player's saved button layouts, copied into the fake library once
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

export type FakeGamesStatus = NonNullable<DevFakeGamesState["status"]>;

const seedLibrary = (store: LibraryStore, layouts: LibraryFile["layouts"], now: number): void => {
  const key = (title: string) => fakeKey(FAKE_GAMES.find((g) => g.title === title)!);
  const ratedOn = { app: "0.9.4", build: "19000001", at: now - 3 * 86400_000 };
  // loop: NOT-WORTH — the player's layouts, copied once when the fake library is made
  for (const [id, l] of Object.entries(layouts ?? {})) store.setLayout(id, l.name, l.table, l.extra);
  store.setProfile(key("Cyberpunk 2077"), "Cyberpunk 2077", { format: 2, hapticsGain: 4, hapticsGainRight: 4, speakerVolume: -6, lightbarMode: 2, triggerReduce: 0 });
  store.setMine(key("Cyberpunk 2077"), "Cyberpunk 2077", {
    rating: 5,
    tags: ["triggers-work", "haptics-work", "speaker-works", "lightbar-works"],
    ratedOn,
    notes: "Fake notes: the bow's trigger tension is great; turn the speaker down a little for night city.",
  });
  store.setProfile(key("Hogwarts Legacy"), "Hogwarts Legacy", { format: 2, hapticsGain: 3, lightbarMode: 1, micLevel: 32 });
  store.setProfile(key("The Witcher 3: Wild Hunt"), "The Witcher 3: Wild Hunt", { format: 2, speakerVolume: -12, btMicEnable: false });
  store.setMine(key("Baldur's Gate 3"), "Baldur's Gate 3", { rating: 4, tags: ["haptics-work", "weak-vibration"], ratedOn, notes: "Fake notes: dice rolls rumble nicely." });
  // Rated on an older game build: the page flags the rating as from before an update.
  store.setMine(key("The Last of Us Part I"), "The Last of Us Part I", { rating: 2, tags: ["no-triggers"], ratedOn: { ...ratedOn, build: "18000000" } });
  store.setMine(key("Metro Exodus"), "Metro Exodus", { rating: 3, tags: ["triggers-work", "disconnects"] });
};

export class FakeGamesService {
  // cache: OK — key=none (the fake library's state); invalidated=Apply / Undo / Install change it, a new service starts fresh; bound=20 games
  private state: FakeState = newFakeState();
  private runningKey: string | null = fakeKey(FAKE_GAMES[0]);
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  // cache: OK — key=game key + kind; invalidated=deleted when the picture is written; bound=pictures being drawn (≤ 20 games x 5 kinds)
  private readonly drawing = new Map<string, Promise<string | undefined>>();
  // Pictures are drawn one at a time, so a grid of new art doesn't hold the main process.
  private queue: Promise<unknown> = Promise.resolve();
  private lib: LibraryStore | null = null;

  constructor(private readonly deps: FakeGamesDeps) {}

  private now = (): number => this.deps.now?.() ?? Date.now();
  private wait = (ms: number): Promise<void> =>
    this.deps.wait?.(ms) ??
    new Promise((r) => {
      // lifetime: NOT-WORTH — a one-shot delay of a fake scan or install step, fires once
      setTimeout(r, ms);
    });
  private opts = () => ({ linux: this.deps.platform === "linux", now: new Date(this.now()) });

  // The fake games' own library (profiles, ratings, notes), seeded on first use.
  library(): LibraryStore {
    if (!this.lib) {
      const fresh = !existsSync(join(this.deps.dir, LIBRARY_FILE));
      this.lib = new LibraryStore(this.deps.dir);
      if (fresh) seedLibrary(this.lib, this.deps.layouts?.(), this.now());
    }
    return this.lib;
  }

  async scan(): Promise<GamesReport> {
    await this.wait(SCAN_MS);
    return fakeReport(this.state, this.opts());
  }

  details(): Record<string, GameInfo> {
    return fakeDetails(this.state, this.now());
  }

  async apply(fixIds: string[], restart: RestartList): Promise<ApplyResult> {
    await this.wait(SCAN_MS);
    return fakeApply(this.state, fixIds, restart, this.opts());
  }

  async undo(backupId: string, restart: RestartList): Promise<UndoResult> {
    await this.wait(SCAN_MS);
    return fakeUndo(this.state, backupId, restart);
  }

  listBackups(): GameBackup[] {
    return fakeBackups(this.state);
  }

  runningLaunchers(): LauncherId[] {
    return [...this.state.running];
  }

  // Install: the progress steps the page shows, then the newest build is "installed".
  async installLatestProton(): Promise<ProtonInstallResult> {
    if (this.deps.platform !== "linux") return { ok: false, message: "Proton is only used on Linux." };
    const total = 512 * 1024 * 1024;
    // loop: SERIAL-REQUIRED — the fake download's progress steps, in order (a deadline per step)
    for (let got = 0; got <= total; got += total / 8) {
      this.deps.onProtonProgress({ phase: "downloading", got, total });
      await this.wait(250);
    }
    // loop: SERIAL-REQUIRED — the install's phases, in order
    for (const p of [{ phase: "verifying" }, { phase: "unpacking" }, { phase: "copying", target: "~/.local/share/Steam/compatibilitytools.d" }] as ProtonProgress[]) {
      this.deps.onProtonProgress(p);
      await this.wait(400);
    }
    this.state.ourProton = LATEST_PROTON;
    return { ok: true, name: LATEST_PROTON, installed: [`~/.local/share/Steam/compatibilitytools.d/${LATEST_PROTON}`] };
  }

  // ---- The running game ----
  get running(): string | null {
    return this.runningKey;
  }

  // The Developer card's pick (no time limit), or ▶ Play's (PLAY_MS).
  setRunning(key: string | null, forMs?: number): void {
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
    const game = key ? this.state.games.get(key) : undefined;
    this.runningKey = game ? key : null;
    // A game runs from its launcher: that launcher shows as running too.
    if (game) this.state.running.add(game.def.launcher);
    this.deps.onRunning(this.runningKey);
    if (game && forMs)
      // lifetime: OK — cleared by the next setRunning() or stop(); fires once
      this.playTimer = setTimeout(() => this.setRunning(null), forMs);
  }

  setHdr(hdr: FakeHdr): void {
    if (FAKE_GAMES_HDR.includes(hdr)) this.state.hdr = hdr;
  }

  status(): FakeGamesStatus {
    // loop: NOT-WORTH — 20 fake games, once per Developer card change
    return { running: this.runningKey, hdr: this.state.hdr, games: [...this.state.games].map(([key, g]) => ({ key, title: g.def.title })) };
  }

  // Fake games turned off: the play timer goes (the state is dropped with the service).
  stop(): void {
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
  }

  // A game page action: ▶ Play runs the game for a minute; the rest would
  // open a launcher page or a folder, which the fakes don't have (answered as
  // done, so the page shows no error).
  gameAction(key: string, action: GameAction): boolean {
    if (!this.state.games.has(key)) return false;
    if (action === "play") this.setRunning(key, PLAY_MS);
    return true;
  }

  // ---- Art ----
  // The picture of `kind` for a fake game: drawn and saved on first use, then
  // served from the dev folder like a launcher's file (undefined: it has none).
  artFile(key: string, kind: ArtKind): Promise<string | undefined> {
    const game = this.state.games.get(key);
    const size = game ? ART_SIZES[game.def.art][kind] : undefined;
    if (!game || !size) return Promise.resolve(undefined);
    const png = kind === "logo" || kind === "icon";
    const file = join(this.deps.dir, ART_VERSION, hash32(key).toString(16).padStart(8, "0"), `${kind}.${png ? "png" : "jpg"}`);
    if (existsSync(file)) return Promise.resolve(file);
    const id = `${key}/${kind}`;
    const running = this.drawing.get(id);
    if (running) return running;
    const job = this.queue.then(async () => {
      // A turn of the event loop between pictures: IPC and input go first.
      await new Promise<void>((r) => setImmediate(r));
      const bytes = this.deps.encode(drawArt(kind, game.def.title, size[0], size[1]), png);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(`${file}.tmp`, bytes);
      await rename(`${file}.tmp`, file);
      return file;
    });
    this.queue = job.catch(logged("drawing a fake game's art (Developer card → Fake games; that picture answers 404, the tile keeps its placeholder)"));
    // error: NOT-WORTH — the failure is logged by the queue's catch above; the ds5-art handler answers 404 for undefined
    const done = job.catch(() => undefined).finally(() => this.drawing.delete(id));
    this.drawing.set(id, done);
    return done;
  }

  async artColor(key: string): Promise<string | null> {
    const file = (await this.artFile(key, "cover")) ?? (await this.artFile(key, "hero"));
    return file ? this.deps.colorOf(file) : null;
  }
}
