// Markdown rendered to React elements. No raw HTML (dropped). Images only
// from the app's own bundle: the README's screenshots (docs/screenshots/) are
// bundled and shown; any other image (remote ones are also forbidden by the
// CSP) shows its alt text. Links open in the system browser through the main
// process's URL allowlist.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const bundled = import.meta.glob("../../docs/screenshots/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const SCREENSHOTS = new Map(Object.entries(bundled).map(([path, url]) => [`docs/screenshots/${path.split("/").pop()}`, url]));

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? SCREENSHOTS.get(src.replace(/^\.\//, "")) : undefined;
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
