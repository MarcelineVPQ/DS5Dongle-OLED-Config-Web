// 2026-10-31 app review S4: an Undo that fails part-way (a launcher holds the
// second file) can be retried. The file already put back is skipped, not read
// as "changed since the backup".
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";

let home: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-undo-")));
});
afterEach(() => {
  if (existsSync(join(home, "locked"))) chmodSync(join(home, "locked"), 0o755);
  rmSync(home, { recursive: true, force: true });
});

describe("Undo after a failure part-way", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("succeeds when tried again", () => {
    const backups = new Backups(join(home, "backups"));
    const first = join(home, "a.json");
    mkdirSync(join(home, "locked"));
    const second = join(home, "locked", "b.json");
    writeFileSync(first, "a0");
    writeFileSync(second, "b0");
    const id = backups.run(
      [{ key: "label.defaultHeroic" }],
      [
        { path: first, owner: "heroic" },
        { path: second, owner: "heroic" },
      ],
      () => {
        writeFileSync(first, "a1");
        writeFileSync(second, "b1");
      },
    );

    chmodSync(join(home, "locked"), 0o555); // the second file can't be written
    expect(() => backups.restore(id)).toThrow();
    expect(readFileSync(first, "utf8")).toBe("a0"); // the first one is back already

    chmodSync(join(home, "locked"), 0o755);
    expect(() => backups.restore(id)).not.toThrow();
    expect(readFileSync(first, "utf8")).toBe("a0");
    expect(readFileSync(second, "utf8")).toBe("b0");
  });
});
