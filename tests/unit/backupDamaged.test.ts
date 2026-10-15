// Error pass batch E2: a backup set whose manifest can't be read stays in
// Change history, marked damaged with its folder, instead of disappearing
// (its Undo silently gone).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";

let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-backup-")));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("Change history with a damaged backup (batch E2)", () => {
  it("lists it as damaged, with its folder and when it was made, beside the good ones", () => {
    const dir = join(home, "backups");
    const backups = new Backups(dir);
    const file = join(home, "config.json");
    writeFileSync(file, "{}");
    const good = backups.run([{ key: "label.defaultHeroic" }], [{ path: file, owner: "heroic" }], () => writeFileSync(file, '{"a":1}'));
    const bad = "20261015T123456Z-abcdef";
    mkdirSync(join(dir, bad));
    writeFileSync(join(dir, bad, "manifest.json"), "{ not json");
    const list = backups.list();
    expect(list.map((b) => b.id)).toEqual([good, bad].sort().reverse());
    const damaged = list.find((b) => b.id === bad)!;
    expect(damaged).toEqual({ id: bad, created: "2026-10-15T12:34:56Z", changes: [], files: [], restored: false, damaged: join(dir, bad) });
    expect(list.find((b) => b.id === good)!.damaged).toBeUndefined();
  });
});
