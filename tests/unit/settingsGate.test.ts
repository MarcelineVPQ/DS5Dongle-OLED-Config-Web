// The settings gate (tools/list_settings.mjs): one framework for every
// setting. A settings card, a row or a bare control outside a Section, or a
// Section that isn't lazy or named properly, is a finding; the pages not on
// the accordion yet are allowed theirs, and the list of them only shrinks.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { gateProblems, PENDING, settingsFindings } from "../../tools/list_settings.mjs";

const page = (body: string) => [{ file: "src/desktop/pages/NewPage.tsx", text: `import { Globe } from "lucide-react";\n${body}` }];
const kinds = (body: string) => settingsFindings(page(body)).map((f) => `${f.kind}: ${f.detail}`);

describe("the settings gate", () => {
  it("passes on the app as it is", () => {
    const run = spawnSync(process.execPath, ["tools/list_settings.mjs", "--check"], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("accepts rows in a lazy Section, also through components rendered in one", () => {
    expect(
      kinds(`
      function Rows() { return <Toggle label="a" value onChange={() => {}} />; }
      export default function P() {
        return <Accordion state={acc}><Section id="one" icon={Globe} title={t("x")}>{() => <><Rows /><Row label="b"><select /></Row></>}</Section></Accordion>;
      }`),
    ).toEqual([]);
  });

  it("finds a settings card, a row outside a Section and a bare control", () => {
    expect(
      kinds(`
      export default function P() {
        return <><section className="dk-card"><h2>Old</h2><Toggle label="a" value onChange={() => {}} /></section><select /></>;
      }`),
    ).toEqual(["card: a settings card (dk-card)", "row: <Toggle> outside a Section (in P)", "bare: <select> outside a Row"]);
  });

  it("lets a card that isn't a setting say so, and never counts dialogs", () => {
    expect(
      kinds(`
      export default function P() {
        return <>
          {/* settings-gate: not-settings — the studio's credit card */}
          <section className="dk-card"><h2>42</h2></section>
          <section className="dk-card dk-dialog"><h2>Join?</h2></section>
        </>;
      }`),
    ).toEqual([]);
  });

  it("wants every Section lazy, with a unique id, a lucide icon and a translated title", () => {
    expect(
      kinds(`
      import { Star } from "./icons";
      export default function P() {
        return <Accordion state={acc}>
          <Section id="a" icon={Star} title="Plain"><Row label="x"><input type="range" /></Row></Section>
          <Section id="a" icon={Globe} title={t("y")}>{() => null}</Section>
        </Accordion>;
      }`),
    ).toEqual([
      "section: icon is not a lucide icon",
      "section: title is not translated (t(...))",
      "section: body is not a function ({() => …}): a closed section would still render it",
      'section: id "a" used twice',
    ]);
  });

  it("allows the pages still to move only while they have findings (the list shrinks)", () => {
    const pending = Object.keys(PENDING)[0];
    const finding = { file: pending, line: 1, kind: "card" as const, detail: "x" };
    expect(gateProblems([finding], [pending]).bad).toEqual([]);
    expect(gateProblems([finding], [pending]).stale).not.toContain(pending);
    expect(gateProblems([], [pending]).stale).toContain(pending);
    // A Section problem is never allowed, not even in a page still to move.
    expect(gateProblems([{ ...finding, kind: "section" }], [pending]).bad).toHaveLength(1);
  });
});
