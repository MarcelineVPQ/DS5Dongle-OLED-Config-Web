// Markdown rendered to React elements. No raw HTML (dropped). Images only
// from the app's own bundle: the screenshots in docs/screenshots/ (named as
// the README or the guide name them) are bundled and shown; any other image
// (remote ones are also forbidden by the CSP) shows its alt text. "#section"
// links scroll to that heading (GitHub's slugs); other links open in the
// system browser through the main process's URL allowlist.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const bundled = import.meta.glob("../../docs/screenshots/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
// By file name: "docs/screenshots/x.png" (README) and "screenshots/x.png" (docs/GUIDE.md) are the same file.
const SCREENSHOTS = new Map(Object.entries(bundled).map(([path, url]) => [path.split("/").pop()!, url]));
const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

const components: Components = {
  a: ({ href, children }) =>
    href?.startsWith("#") ? (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          const root = e.currentTarget.closest(".dk-md");
          const target = [...(root?.querySelectorAll("h1, h2, h3, h4") ?? [])].find((h) => slug(h.textContent ?? "") === decodeURIComponent(href.slice(1)));
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
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

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="dk-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
