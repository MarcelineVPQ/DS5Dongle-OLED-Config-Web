// The narrator's words while she speaks (or, with the voice off, the short
// confirmations as text): a caption at the bottom of the window, also read
// out by screen readers. See narrator.ts for when it shows.
import { useCaption } from "./narrator";

export default function NarratorCaption() {
  const caption = useCaption();
  return (
    <div className="narrator-caption-wrap" aria-live="polite" aria-atomic="true">
      {caption && (
        <p className="narrator-caption" key={caption.key}>
          {caption.text}
        </p>
      )}
    </div>
  );
}
