// Text VDF (Valve KeyValues), as used by Steam's config.vdf, localconfig.vdf,
// libraryfolders.vdf and appmanifest_*.acf. Our own implementation (MIT).
//
// Entries are kept as an ordered list, not a plain object: JavaScript reorders
// integer-like object keys (Steam app ids like "1091500"), and rewriting a
// Steam file must not shuffle it. Key lookups ignore case, because Steam itself
// writes both "Valve" and "valve".

export type VdfValue = string | VdfNode;
export type VdfNode = Array<[string, VdfValue]>;

// Steam's comments (`//`) are not kept; the files we rewrite don't have any.

export class VdfSyntaxError extends Error {}

// Marks an escape we don't decode (e.g. `\\x`), so it is written back as is.
const RAW_ESCAPE = "\uE000";

export function parseVdf(text: string): VdfNode {
  let i = 0;
  const n = text.length;

  const skip = () => {
    for (;;) {
      // loop: HOT-PATH-OK — skips whitespace, linear in the file
      while (i < n && /\s/.test(text[i])) i++;
      if (text.startsWith("//", i)) {
        // loop: HOT-PATH-OK — skips one comment line, linear
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      return;
    }
  };

  const token = (): string | null => {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === "{" || c === "}") {
      i++;
      return c;
    }
    if (c === '"') {
      i++;
      let out = "";
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n) {
          const e = text[i + 1];
          // Known escapes are decoded; any other one is kept exactly as
          // written (marked, so serializing doesn't double its backslash).
          out += e === "n" ? "\n" : e === "t" ? "\t" : e === "\\" || e === '"' ? e : RAW_ESCAPE + e;
          i += 2;
        } else out += text[i++];
      }
      if (i >= n) throw new VdfSyntaxError("Unterminated string");
      i++;
      return `"${out}`; // leading quote marks a string token
    }
    // Platform conditionals ([$WIN32] after a value) aren't supported: refuse
    // the file rather than misread every key after one and rewrite it wrong.
    if (c === "[") throw new VdfSyntaxError("Conditional ([$...]) entries aren't supported");
    // Unquoted token (rare in Steam files, legal in KeyValues).
    const start = i;
    while (i < n && !/[\s{}"]/.test(text[i])) i++;
    return `"${text.slice(start, i)}`;
  };

  const parseBlock = (nested: boolean): VdfNode => {
    const node: VdfNode = [];
    for (;;) {
      const key = token();
      if (key === null) {
        if (nested) throw new VdfSyntaxError("Unexpected end of file");
        return node;
      }
      if (key === "}") {
        if (!nested) throw new VdfSyntaxError("Unexpected }");
        return node;
      }
      if (key === "{") throw new VdfSyntaxError("Unexpected {");
      const value = token();
      if (value === null) throw new VdfSyntaxError(`Missing value for ${key.slice(1)}`);
      if (value === "{") node.push([key.slice(1), parseBlock(true)]);
      else if (value === "}") throw new VdfSyntaxError(`Missing value for ${key.slice(1)}`);
      else node.push([key.slice(1), value.slice(1)]);
    }
  };

  return parseBlock(false);
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replaceAll(RAW_ESCAPE, "\\");
}

// Steam's own layout: tab indentation, two tabs between key and value.
export function serializeVdf(node: VdfNode, depth = 0): string {
  const pad = "\t".repeat(depth);
  let out = "";
  for (const [key, value] of node) {
    if (typeof value === "string") out += `${pad}"${escape(key)}"\t\t"${escape(value)}"\n`;
    else out += `${pad}"${escape(key)}"\n${pad}{\n${serializeVdf(value, depth + 1)}${pad}}\n`;
  }
  return out;
}

export function getKey(node: VdfNode, key: string): VdfValue | undefined {
  const k = key.toLowerCase();
  // loop: NOT-WORTH — one lookup in one node; the scan's per-game lookups in localconfig's thousands of apps use keyIndex (loop pass batch 3)
  return node.find(([name]) => name.toLowerCase() === k)?.[1];
}

// A node's keys (lowercased; the first of a repeated key wins, as in getKey)
// in a Map, for many lookups in one big node.
export function keyIndex(node: VdfNode | undefined): Map<string, VdfValue> {
  const index = new Map<string, VdfValue>();
  // loop: NOT-WORTH — one pass over one node, once per scan
  for (const [name, value] of node ?? []) if (!index.has(name.toLowerCase())) index.set(name.toLowerCase(), value);
  return index;
}

export function getNode(node: VdfNode | undefined, ...path: string[]): VdfNode | undefined {
  let cur: VdfValue | undefined = node;
  // loop: NOT-WORTH — path segments of one lookup
  for (const key of path) {
    if (!cur || typeof cur === "string") return undefined;
    cur = getKey(cur, key);
  }
  return cur && typeof cur !== "string" ? cur : undefined;
}

export function getString(node: VdfNode | undefined, ...path: string[]): string | undefined {
  if (!node || path.length === 0) return undefined;
  const parent = getNode(node, ...path.slice(0, -1));
  const v = parent ? getKey(parent, path[path.length - 1]) : undefined;
  return typeof v === "string" ? v : undefined;
}

// Set `key` in `node` (replacing in place, case-insensitively), or append it.
export function setKey(node: VdfNode, key: string, value: VdfValue): void {
  const k = key.toLowerCase();
  const idx = node.findIndex(([name]) => name.toLowerCase() === k);
  if (idx >= 0) node[idx] = [node[idx][0], value];
  else node.push([key, value]);
}

// Walk (creating missing blocks) and return the node at `path`.
export function ensureNode(node: VdfNode, ...path: string[]): VdfNode {
  let cur = node;
  for (const key of path) {
    const existing = getKey(cur, key);
    if (existing && typeof existing !== "string") cur = existing;
    else {
      const created: VdfNode = [];
      setKey(cur, key, created);
      cur = created;
    }
  }
  return cur;
}

export function removeKey(node: VdfNode, key: string): boolean {
  const k = key.toLowerCase();
  const idx = node.findIndex(([name]) => name.toLowerCase() === k);
  if (idx < 0) return false;
  node.splice(idx, 1);
  return true;
}
