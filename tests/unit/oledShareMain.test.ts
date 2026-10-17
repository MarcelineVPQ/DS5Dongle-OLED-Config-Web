// Share your OLED, the main process's half (electron/main/oledShare.ts): the
// path comes from the save dialog alone (its extension forced to the kind's),
// a cancel writes nothing, a failed write reaches the page as an error, and
// the clipboard gets only a PNG the system can read.
import { describe, expect, it, vi } from "vitest";
import { copyOledImage, defaultName, saveOledImage, withExtension, type SaveDeps } from "../../electron/main/oledShare";
import { GIF_MAGIC, PNG_MAGIC } from "../../src/oled/oledShare";

const png = Uint8Array.from([...PNG_MAGIC, 1, 2, 3]);
const gif = Uint8Array.from([...GIF_MAGIC, 1, 2, 3]);
const at = new Date(2026, 9, 14, 21, 30, 5);

function deps(chosen: string | null | Array<string | null>, write: SaveDeps["write"] = vi.fn(), existing: string[] = []): SaveDeps & { asked: Array<Parameters<SaveDeps["ask"]>[0]> } {
  const asked: Array<Parameters<SaveDeps["ask"]>[0]> = [];
  const answers = Array.isArray(chosen) ? [...chosen] : null;
  return {
    asked,
    ask: (o) => {
      asked.push(o);
      return Promise.resolve(answers ? (answers.shift() ?? null) : (chosen as string | null));
    },
    write,
    exists: (path) => existing.includes(path),
    pictures: () => "/home/me/Pictures",
    now: () => at,
  };
}

describe("Share: saving", () => {
  it("offers a dated name in Pictures, with the kind's filter", async () => {
    const d = deps(null);
    await saveOledImage(d, { kind: "gif", bytes: gif });
    expect(d.asked[0].defaultPath.replace(/\\/g, "/")).toBe("/home/me/Pictures/ds5-oled-2026-10-14-213005.gif");
    expect(d.asked[0].filters).toEqual([{ name: "GIF", extensions: ["gif"] }]);
    expect(defaultName("png", at)).toBe("ds5-oled-2026-10-14-213005.png");
  });

  it("a cancel writes nothing and says so", async () => {
    const write = vi.fn();
    expect(await saveOledImage(deps(null, write), { kind: "png", bytes: png })).toEqual({ saved: false });
    expect(write).not.toHaveBeenCalled();
  });

  it("writes the bytes where the dialog says, with the kind's extension forced", async () => {
    const write = vi.fn();
    expect(await saveOledImage(deps("/tmp/x/my screen", write), { kind: "png", bytes: png })).toEqual({ saved: true, name: "my screen.png" });
    expect(write).toHaveBeenCalledWith("/tmp/x/my screen.png", Buffer.from(png));
    expect(withExtension("/a/b.PNG", "png")).toBe("/a/b.PNG");
    expect(withExtension("/a/b.png", "gif")).toBe("/a/b.png.gif");
    expect(withExtension("/a/b.sh", "gif")).toBe("/a/b.sh.gif");
  });

  // Bug hunt A8 (0.9.5): the extension added after the dialog approved a name
  // could point at a file that's already there, overwritten without asking.
  it("an added extension that names an existing file asks again on that name, never overwrites unasked", async () => {
    const write = vi.fn();
    const d = deps(["/tmp/x/shot", "/tmp/x/shot.png"], write, ["/tmp/x/shot.png"]);
    expect(await saveOledImage(d, { kind: "png", bytes: png })).toEqual({ saved: true, name: "shot.png" });
    expect(d.asked).toHaveLength(2);
    expect(d.asked[1].defaultPath, "the dialog opens on the real name, so the system asks to replace it").toBe("/tmp/x/shot.png");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("/tmp/x/shot.png", Buffer.from(png));
  });

  it("cancelling the second ask writes nothing", async () => {
    const write = vi.fn();
    expect(await saveOledImage(deps(["/tmp/x/shot", null], write, ["/tmp/x/shot.png"]), { kind: "png", bytes: png })).toEqual({ saved: false });
    expect(write).not.toHaveBeenCalled();
  });

  it("a name the dialog approved as it is (its extension already right) is written at once", async () => {
    const write = vi.fn();
    const d = deps("/tmp/x/shot.png", write, ["/tmp/x/shot.png"]);
    await saveOledImage(d, { kind: "png", bytes: png });
    expect(d.asked).toHaveLength(1);
    expect(write).toHaveBeenCalledWith("/tmp/x/shot.png", Buffer.from(png));
  });

  it("a failed write rejects, so the page shows it", async () => {
    const write = () => {
      throw new Error("EACCES: permission denied");
    };
    await expect(saveOledImage(deps("/root/x.png", write), { kind: "png", bytes: png })).rejects.toThrow("EACCES");
  });
});

describe("Share: copying", () => {
  it("puts a readable PNG on the clipboard", async () => {
    const write = vi.fn(() => Promise.resolve());
    await copyOledImage({ decodes: () => true, write }, png);
    expect(write).toHaveBeenCalledWith(Buffer.from(png));
  });

  it("refuses bytes the system can't read as a picture", async () => {
    const write = vi.fn(() => Promise.resolve());
    await expect(copyOledImage({ decodes: () => false, write }, png)).rejects.toThrow(/couldn't be read/);
    expect(write).not.toHaveBeenCalled();
  });

  it("a clipboard failure rejects", async () => {
    await expect(copyOledImage({ decodes: () => true, write: () => Promise.reject(new Error("no clipboard")) }, png)).rejects.toThrow("no clipboard");
  });
});
