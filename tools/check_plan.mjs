// Test plans for the UI checker (tools/check_layout.mjs): pure functions, no
// app, unit-tested (tests/unit/checkPlan.test.ts).
//
// The fast plan (dev builds) doesn't render every combination of language,
// window size, theme, page group and controller model. It renders a covering
// array instead: every PAIR of values (de at 900x650, dark with the Games
// group, the Edge in Japanese...) appears in at least one rendered
// combination. Most layout and contrast faults need one or two of those
// things to line up (a long German label in a narrow card; a theme's muted
// text on one page's inset), which is what pairwise testing covers; a fault
// that needs three specific values at once is left to the full plan
// (stable releases).

// A small deterministic PRNG (mulberry32): the same seed, the same plan.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Every pair of values of two different factors, as keys.
const pairKey = (i, a, j, b) => (i < j ? `${i}.${a}|${j}.${b}` : `${j}.${b}|${i}.${a}`);
function allPairKeys(sizes) {
  const keys = [];
  for (let i = 0; i < sizes.length; i++) for (let j = i + 1; j < sizes.length; j++) for (let a = 0; a < sizes[i]; a++) for (let b = 0; b < sizes[j]; b++) keys.push(pairKey(i, a, j, b));
  return keys;
}

// A covering array: combinations (objects factor -> value) such that every
// pair of values of any two factors appears in at least one. Greedy (AETG
// style): each new combination is the best of `candidates` random ones, each
// grown from a still-uncovered pair by picking, factor by factor, the value
// that covers the most new pairs. `required` combinations (some factors
// fixed, the rest filled in the same way) come first.
//   factors: { lang: ["en", "de"], size: [...], ... }
export function allPairs(factors, { seed = 1, required = [], candidates = 30 } = {}) {
  const names = Object.keys(factors);
  const values = names.map((n) => factors[n]);
  for (const [i, v] of values.entries()) if (!v.length) throw new Error(`factor ${names[i]} has no values`);
  const random = rng(seed);
  const uncovered = new Set(allPairKeys(values.map((v) => v.length)));
  const newPairs = (test, f, v) => {
    let n = 0;
    for (let j = 0; j < test.length; j++) if (j !== f && test[j] >= 0 && uncovered.has(pairKey(f, v, j, test[j]))) n++;
    return n;
  };
  const complete = (partial) => {
    const test = [...partial];
    const free = names.map((_, i) => i).filter((i) => test[i] < 0);
    for (let k = free.length - 1; k > 0; k--) {
      const r = Math.floor(random() * (k + 1));
      [free[k], free[r]] = [free[r], free[k]];
    }
    for (const f of free) {
      let best = -1;
      let ties = [];
      for (let v = 0; v < values[f].length; v++) {
        const n = newPairs(test, f, v);
        if (n > best) [best, ties] = [n, [v]];
        else if (n === best) ties.push(v);
      }
      test[f] = ties[Math.floor(random() * ties.length)];
    }
    return test;
  };
  const score = (test) => {
    let n = 0;
    for (let i = 0; i < test.length; i++) for (let j = i + 1; j < test.length; j++) if (uncovered.has(pairKey(i, test[i], j, test[j]))) n++;
    return n;
  };
  const cover = (test) => {
    for (let i = 0; i < test.length; i++) for (let j = i + 1; j < test.length; j++) uncovered.delete(pairKey(i, test[i], j, test[j]));
  };
  const tests = [];
  for (const req of required) {
    const partial = names.map((n, i) => {
      if (!(n in req)) return -1;
      const v = values[i].indexOf(req[n]);
      if (v < 0) throw new Error(`required ${n}=${req[n]} is not one of its values`);
      return v;
    });
    const test = complete(partial);
    tests.push(test);
    cover(test);
  }
  while (uncovered.size) {
    const open = [...uncovered];
    let best = null;
    let bestScore = -1;
    for (let c = 0; c < candidates; c++) {
      const [p, q] = open[Math.floor(random() * open.length)].split("|").map((s) => s.split(".").map(Number));
      const partial = names.map(() => -1);
      partial[p[0]] = p[1];
      partial[q[0]] = q[1];
      const test = complete(partial);
      const s = score(test);
      if (s > bestScore) [best, bestScore] = [test, s];
    }
    tests.push(best);
    cover(best);
  }
  return tests.map((t) => Object.fromEntries(names.map((n, i) => [n, values[i][t[i]]])));
}

// How many of the factor-value pairs the combinations cover.
export function pairCoverage(factors, tests) {
  const names = Object.keys(factors);
  const values = names.map((n) => factors[n]);
  const all = new Set(allPairKeys(values.map((v) => v.length)));
  const covered = new Set();
  for (const t of tests) {
    const idx = names.map((n, i) => values[i].indexOf(t[n]));
    for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) if (idx[i] >= 0 && idx[j] >= 0) covered.add(pairKey(i, idx[i], j, idx[j]));
  }
  return { pairs: all.size, covered: [...covered].filter((k) => all.has(k)).length };
}

// Combinations sorted so the expensive switches (a reload for language,
// theme or style) happen as rarely as possible: by the given keys in order.
export function sortTests(tests, keys) {
  return [...tests].sort((x, y) => {
    for (const k of keys) {
      const c = String(x[k]).localeCompare(String(y[k]));
      if (c) return c;
    }
    return 0;
  });
}

const area = (s) =>
  s
    .split("x")
    .map(Number)
    .reduce((a, b) => a * b, 1);

// Which of its group's views each combination renders (`views`: indices into
// the group's view list). A combination marked `full` renders them all; the
// others render a slice, rotated so that every view still comes up at least
// once for every value of `coverKey` (each window size, each style), and at
// least a quarter of the group each time. Sampling within a group keeps
// every pair of values covered at the group level while each language or
// theme sees only part of a big group's views.
export function assignViews(tests, { groupSizes, coverKey }) {
  const out = tests.map((t) => ({ ...t }));
  const buckets = new Map();
  for (const t of out) {
    if (t.full) {
      t.views = [...Array(groupSizes[t.group]).keys()];
      continue;
    }
    const k = `${t.group}|${t[coverKey]}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  for (const [k, list] of buckets) {
    const [group, value] = k.split("|");
    const n = groupSizes[group];
    const covered = out.some((t) => t.full && t.group === group && String(t[coverKey]) === value);
    const size = Math.min(n, Math.max(Math.ceil(n / 4), covered ? 0 : Math.ceil(n / list.length)));
    let next = 0;
    for (const t of list) {
      t.views = [];
      for (let i = 0; i < size; i++) t.views.push((next + i) % n);
      next = (next + size) % n;
    }
  }
  for (const t of out) t.views.sort((x, y) => x - y);
  return out;
}

// The fast plan's layout (and names) combinations: pairwise over language,
// size, theme, page group and model, plus the risky singles in full:
//   - the long-translation languages (`riskyLangs`: de, es, fr, pt-BR) at
//     the smallest size, every view of every group: long words break narrow
//     cards;
//   - every view at least once per size (assignViews).
export const RISKY_LANGS = ["de", "es", "fr", "pt-BR"];
export function layoutPlan({ langs, sizes, themes, groups, groupSizes, models, riskyLangs = RISKY_LANGS, seed = 1 }) {
  const smallest = [...sizes].sort((a, b) => area(a) - area(b))[0];
  const required = [];
  for (const lang of riskyLangs.filter((l) => langs.includes(l))) for (const group of groups) required.push({ lang, size: smallest, group });
  for (const size of sizes) if (size !== smallest) for (const group of groups) required.push({ size, group });
  const factors = { lang: langs, size: sizes, theme: themes, group: groups, model: models };
  const tests = allPairs(factors, { seed, required }).map((t, i) => (i < required.length && required[i].lang ? { ...t, full: true } : t));
  return { factors, tests: sortTests(assignViews(tests, { groupSizes, coverKey: "size" }), ["lang", "theme", "size", "model", "group"]) };
}

// The fast plan's contrast combinations (English, normal size): pairwise
// over theme, style, page group and model, every view at least once per
// style. Colorways, and the themes on the token pairs the renders found, are
// computed (tools/colorway_contrast.mjs).
export function contrastPlan({ themes, styles, groups, groupSizes, models, seed = 1 }) {
  const factors = { theme: themes, style: styles, group: groups, model: models };
  return { factors, tests: sortTests(assignViews(allPairs(factors, { seed }), { groupSizes, coverKey: "style" }), ["theme", "style", "model", "group"]) };
}

// Rough time of a plan: a reload per language/theme/style change, then the
// cost (its waits, ms) of each view a combination renders.
export function estimateMs(tests, { reloadKeys, viewsOf, reloadMs = 5600 }) {
  let ms = 0;
  let last = null;
  for (const t of tests) {
    const key = reloadKeys.map((k) => t[k]).join("/");
    if (key !== last) ms += reloadMs;
    last = key;
    for (const v of viewsOf(t)) ms += v.cost;
  }
  return ms;
}

export const minutes = (ms) => `${(ms / 60000).toFixed(1)} min`;
