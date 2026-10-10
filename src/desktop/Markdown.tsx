// Markdown rendered to React elements. No raw HTML (dropped), no remote
// images (the CSP forbids them; their alt text is shown instead), and links
// open in the system browser through the main process's URL allowlist.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ alt }) => (alt ? <span className="dk-md-imgalt">{alt}</span> : null),
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
