// The hint gate (tools/list_hints.mjs): a visible hint longer than the limit
// (a Row's `sub`, a dk-hint paragraph) fails unless it says why it must stay
// on screen; the explanation behind the ⓘ (`info`) has no limit.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { HINT_LIMIT, hintFindings } from "../../tools/list_hints.mjs";

const LONG = "x".repeat(HINT_LIMIT + 1);
const SHORT = "0 = never";
const strings = new Map([
  ["a.long", LONG],
  ["a.short", SHORT],
  ["a.mode.one", SHORT],
  ["a.mode.two", LONG],
  ["d.timing.hint", LONG],
]);
const run = (text: string) => hintFindings([{ file: "src/desktop/X.tsx", text }], strings).map((r) => `${r.kind} ${r.key}${r.mustShow ? " must-show" : ""}`);

describe("the hint gate", () => {
  it("passes on the app as it is", () => {
    const run = spawnSync(process.execPath, ["tools/list_hints.mjs", "--check"], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  it("finds a long sub and a long hint paragraph, not a short one or an ⓘ", () => {
    expect(
      run(`const A = () => <>
        <Toggle label={t("l")} sub={t("a.long")} />
        <Row label={t("l")} sub={t("a.short")} info={t("a.long")}><input /></Row>
        <p className="dk-hint">{t("a.long")}</p>
        <SectionGroup title={t("l")} info={t("a.long")}><p className="dk-hint">{t("a.short")}</p></SectionGroup>
      </>;`),
    ).toEqual(["sub a.long", "hint a.long"]);
  });

  it("takes a template key's longest text, and a file's own t() helper", () => {
    expect(
      run(`const td = (k) => t(\`d.\${k}\`);
        const A = ({ m }) => <><p className="dk-hint">{t(\`a.mode.\${m}\`)}</p><p className="dk-hint">{td("timing.hint")}</p></>;`),
    ).toEqual(["hint `a.mode.${m}`", "hint d.timing.hint"]);
  });

  it("passes a long one marked must-show with its reason (JSX or JS comment), not a bare marker", () => {
    expect(
      run(`const A = ({ x }) => <>
        {/* hint: MUST-SHOW — a warning before Apply */}
        <p className="dk-hint">{t("a.long")}</p>
        {x && (
          // hint: MUST-SHOW — a status
          <p className="dk-hint">{t("a.long")}</p>
        )}
        {/* hint: MUST-SHOW */}
        <p className="dk-hint">{t("a.long")}</p>
      </>;`),
    ).toEqual(["hint a.long must-show", "hint a.long must-show", "hint a.long"]);
  });
});
