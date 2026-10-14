// The settings gate (tools/list_settings.mjs): one framework for every
// setting. A settings card, a row or a bare control outside a Section, or a
// Section that isn't lazy or named properly, is a finding; only the files
// that aren't settings pages are allowed theirs, and that list only shrinks.
// The operating rule: a Section holds settings and actions only; a Section
// that only shows something (a readout) fails, readouts go in a MainBlock.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { gateProblems, NAVIGATION_SECTIONS, NOT_SETTINGS, READOUT_RULE, READOUTS_PENDING, settingsFindings } from "../../tools/list_settings.mjs";

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
      `readout: section "a" has no setting or action (a control, a button, a link): ${READOUT_RULE}`,
    ]);
  });

  it("allows findings only in the files that aren't settings pages, while they have some (the list shrinks)", () => {
    const other = Object.keys(NOT_SETTINGS)[0];
    const finding = { file: other, line: 1, kind: "row" as const, detail: "x" };
    expect(gateProblems([finding], [other]).bad).toEqual([]);
    expect(gateProblems([finding], [other]).stale).not.toContain(other);
    expect(gateProblems([], [other]).stale).toContain(other);
    // Every page is on the accordion: a page's finding is never allowed.
    expect(gateProblems([{ ...finding, file: "src/desktop/pages/GamesPage.tsx" }], [other, "src/desktop/pages/GamesPage.tsx"]).bad).toHaveLength(1);
    // A Section problem is never allowed anywhere.
    expect(gateProblems([{ ...finding, kind: "section" }], [other]).bad).toHaveLength(1);
  });

  it("fails a Section that only shows something: readouts go in the page's main view", () => {
    expect(
      kinds(`
      function Facts() { return <dl><dt>Firmware</dt><dd>1.2</dd><Notice closable>gone</Notice></dl>; }
      export default function P() {
        return <Accordion state={acc}>
          <Section id="facts" icon={Globe} title={t("x")}>{() => <Facts />}</Section>
          <Section id="act" icon={Globe} title={t("y")}>{() => <><Facts /><button type="button">Go</button></>}</Section>
        </Accordion>;
      }`),
    ).toEqual([`readout: section "facts" has no setting or action (a control, a button, a link): ${READOUT_RULE}`]);
  });

  it("follows a Section's controls into memo()ed components and other files", () => {
    const sources = [
      ...page(`
      const List = memo(ListBody);
      function ListBody() { return <ul><li><LanguageToggle /></li></ul>; }
      export default function P() { return <Accordion state={acc}><Section id="a" icon={Globe} title={t("x")}>{() => <List />}</Section></Accordion>; }`),
      { file: "src/components/LanguageToggle.tsx", text: "export default function LanguageToggle() { return <select />; }", lookup: true },
    ];
    expect(settingsFindings(sources)).toEqual([]);
  });

  it("lets a readout keep its own action in its MainBlock, never a setting; a MainBlock's body never comes back into a Section", () => {
    expect(
      kinds(`
      function Timings() { return <><dl /><BusyButton onClick={reset}>Reset</BusyButton></>; }
      function Info() { return <Toggle label="a" value onChange={() => {}} />; }
      export default function P() {
        return <>
          <MainBlock state={b} icon={Globe} title={t("d")}>{() => <Timings />}</MainBlock>
          <MainBlock state={c} icon={Globe} title={t("i")}>{() => <Info />}</MainBlock>
          <Accordion state={acc}><Section id="back" icon={Globe} title={t("x")}>{() => <Timings />}</Section></Accordion>
        </>;
      }`),
    ).toEqual(["row: <Toggle> outside a Section (in Info)", `readout: section "back" shows <Timings>, a main-view readout (a MainBlock's body): ${READOUT_RULE}`]);
  });

  it("counts jump links in a <nav> only on the listed navigation pages", () => {
    const nav = `export default function P() { return <Accordion state={acc}><Section id="toc" icon={Globe} title={t("x")}>{() => <nav><button type="button">Ch 1</button></nav>}</Section></Accordion>; }`;
    expect(kinds(nav)).toEqual(['nav: section "toc" navigates (a <nav> of jump links)', `readout: section "toc" has no setting or action (a control, a button, a link): ${READOUT_RULE}`]);
    const about = Object.keys(NAVIGATION_SECTIONS)[0];
    const rows = settingsFindings([{ file: about, text: `import { Globe } from "lucide-react";\n${nav}` }]);
    expect(rows.map((r) => r.kind)).toEqual(["nav"]);
    expect(gateProblems(rows, [about]).bad).toEqual([]);
    expect(gateProblems([], [about]).stale).toContain(about);
  });

  it("has no readouts waiting for the owner's call: a readout section is never allowed", () => {
    expect(READOUTS_PENDING).toEqual({});
    const file = "src/desktop/pages/GamesPage.tsx";
    const readout = { file, line: 1, kind: "readout" as const, detail: 'section "computer" has no setting or action' };
    expect(gateProblems([readout], [file]).bad).toHaveLength(1);
  });
});
