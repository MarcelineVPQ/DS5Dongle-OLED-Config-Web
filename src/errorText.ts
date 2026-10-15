// The readable text of anything thrown (an Error's message, else the value
// itself), for showing in the UI and logs. Shared by the app and main process.
export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// An error the user needn't see, logged with the one-line reason why, never
// dropped (CLAUDE.md "Error pass"): `promise.catch(logged("why"))`, or
// `logged("why")(cause)` in a catch block. tools/list_errors.mjs reads the
// reason as the row's LOGGED-OK verdict.
export function logged(why: string): (cause: unknown) => void {
  return (cause) => console.warn(`${why}:`, errorText(cause));
}

// Text the user may see, from code that has no translations (the main
// process, the protocol code): a locale key with its parameters, never
// English (error pass batch E3). It travels as a string, so it survives IPC,
// result fields and being put inside another message:
// ⟦desktop.errors.main.diskSpace|{"dir":"/home/…","gb":2}⟧. The page turns
// it into the user's language (`translateKeyed`, through causeText /
// shownText in src/desktop/shownError.ts); a log shows the key and values.
export type TextParams = Record<string, string | number>;
const KEYED = /⟦([\w.-]+)(?:\|(\{[^⟧]*\}))?⟧/g;

export function keyedText(key: string, params?: TextParams): string {
  // ⟦ and ⟧ inside a value are escaped, so the text always ends at its own ⟧.
  const json = params ? `|${JSON.stringify(params).replace(/[⟦⟧]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)}` : "";
  return `⟦${key}${json}⟧`;
}

// An error whose message is keyed text (above).
export class KeyedError extends Error {
  constructor(
    readonly key: string,
    readonly params?: TextParams,
    options?: ErrorOptions,
  ) {
    super(keyedText(key, params), options);
    this.name = "KeyedError";
  }
}

// Every keyed text in `text` translated with `t`; a value that is keyed text
// itself (a cause inside a message) too. Other text is left as it is.
export function translateKeyed(text: string, t: (key: string, params: TextParams) => string): string {
  return text.replace(KEYED, (_whole, key: string, json: string | undefined) => {
    let params: TextParams = {};
    try {
      params = json ? (JSON.parse(json) as TextParams) : {};
    } catch {
      // error: NOT-WORTH — our own JSON, escaped when written; a broken one shows the message without its values
    }
    // loop: NOT-WORTH — the few values of one message
    for (const [k, v] of Object.entries(params)) if (typeof v === "string") params[k] = translateKeyed(v, t);
    return t(key, params);
  });
}
