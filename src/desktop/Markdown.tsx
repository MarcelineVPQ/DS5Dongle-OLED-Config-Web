// Markdown rendered to React elements. No raw HTML (dropped). Images only
// from the app's own bundle: the screenshots in docs/screenshots/ (named as
// the README or the guide name them) are bundled and shown; any other image
// (remote ones are also forbidden by the CSP) shows its alt text. "#section"
// links scroll to that heading (GitHub's slugs); other links open in the
// system browser through the main process's URL allowlist.
import { memo, type ReactElement } from "react";
import renderMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { reducedMotionNow } from "./motion";

const bundled = import.meta.glob("../../docs/screenshots/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
// By file name: "docs/screenshots/x.png" (README) and "screenshots/x.png" (docs/GUIDE.md) are the same file.
const SCREENSHOTS = new Map(Object.entries(bundled).map(([path, url]) => [path.split("/").pop()!, url]));
const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

// A heading's text without Markdown marks: "[0.9.5] - date" and a linked
// "0.9.5 - date" read the same.
export const plainHeading = (text: string): string =>
  text
    .replace(/\[([^\]]*)\](\([^)]*\))?/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// The chapters of a Markdown text (outside code blocks), plain: its level-2
// headings, or its level-3 ones when it has none (Credits). About's sections
// list them.
export function markdownHeadings(text: string): string[] {
  let fenced = false;
  const out: Record<"## " | "### ", string[]> = { "## ": [], "### ": [] };
  // loop: NOT-WORTH — N = the text's lines (a few thousand at most); once per text (About memoizes it)
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced && line.startsWith("## ")) out["## "].push(plainHeading(line.slice(3)));
    else if (!fenced && line.startsWith("### ")) out["### "].push(plainHeading(line.slice(4)));
  }
  return out["## "].length ? out["## "] : out["### "];
}

// Scrolls to the first heading under `root` that matches (smoothly, unless motion is reduced).
export function scrollToHeading(root: ParentNode | null | undefined, match: (heading: string) => boolean): void {
  // loop: NOT-WORTH — N = the shown text's headings (≤ ~100); on a click
  const target = [...(root?.querySelectorAll("h1, h2, h3, h4") ?? [])].find((h) => match(h.textContent ?? ""));
  target?.scrollIntoView({ behavior: reducedMotionNow() ? "auto" : "smooth", block: "start" });
}

const components: Components = {
  a: ({ href, children }) =>
    href?.startsWith("#") ? (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          scrollToHeading(e.currentTarget.closest(".dk-md"), (h) => slug(h) === decodeURIComponent(href.slice(1)));
        }}
      >
        {children}
      </a>
    ) : (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ),
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? SCREENSHOTS.get(src.split("/").pop() ?? "") : undefined;
    if (url) return <img className="dk-md-img" src={url} alt={alt ?? ""} loading="lazy" />;
    return alt ? <span className="dk-md-imgalt">{alt}</span> : null;
  },
};

// A text parsed once: react-markdown's parse (remark, GFM, to React elements)
// is the costly part (~100 ms for the app's CHANGELOG), and its result is a
// plain element tree that can be shown again as is. Keyed by the text itself;
// the oldest drops past the bound (About's bundled texts plus a feed's notes).
const PARSED_MAX = 8;
// cache: OK — key=the Markdown text; invalidated=never needed (same text, same elements); bound=PARSED_MAX texts (about 1 MB for the CHANGELOG's elements), oldest dropped
const parsed = new Map<string, ReactElement>();
function parse(text: string): ReactElement {
  let el = parsed.get(text);
  if (!el) {
    el = renderMarkdown({ children: text, remarkPlugins: [remarkGfm], components, skipHtml: true });
    if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value!);
    parsed.set(text, el);
  }
  return el;
}

// Memo: a page re-rendering around the same text leaves it alone.
export default memo(function Markdown({ text }: { text: string }) {
  return <div className="dk-md">{parse(text)}</div>;
});
