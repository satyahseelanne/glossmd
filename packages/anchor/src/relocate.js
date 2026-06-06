// @gloss/anchor — src/relocate.js
//
// Anchoring binds a comment to a span of *rendered* text (not markdown source).
// We store a TextQuoteSelector: the quoted text plus a short prefix and suffix
// of surrounding context (W3C Web Annotation model). On load we re-find the span
// in the current rendered plaintext by fuzzy match. If we can't, the comment is
// an orphan — shown separately, never silently dropped.
//
// This module is pure string logic: it takes rendered plaintext + a selector and
// returns a character range or null. That makes it testable without a DOM, and
// it's the same logic a VS Code extension would reuse.

/**
 * @typedef {object} TextQuoteSelector
 * @property {string} quote   - the exact rendered text the reviewer selected
 * @property {string} [prefix]- up to ~30 chars immediately before the quote
 * @property {string} [suffix]- up to ~30 chars immediately after the quote
 * @property {object} [textPosition] - { start, end } fast-path hint only
 */

/**
 * Re-locate a selector in rendered plaintext.
 * Strategy, cheapest first:
 *   1. Exact unique quote match → use it.
 *   2. Multiple quote matches → disambiguate with prefix/suffix context.
 *   3. Position hint → verify the quote is at/near the stored offset.
 *   4. Fail → orphan.
 *
 * @param {string} text - current rendered plaintext of the document
 * @param {TextQuoteSelector} selector
 * @returns {{ start: number, end: number, exact: boolean } | null}
 */
export function relocate(text, selector) {
  const { quote, prefix = "", suffix = "" } = selector;
  if (!quote) return null;

  const hits = allIndexesOf(text, quote);

  if (hits.length === 1) {
    const start = hits[0];
    return { start, end: start + quote.length, exact: true };
  }

  if (hits.length > 1) {
    // Disambiguate by how well surrounding context matches.
    let best = null;
    let bestScore = -1;
    for (const start of hits) {
      const score = contextScore(text, start, quote, prefix, suffix);
      if (score > bestScore) { bestScore = score; best = start; }
    }
    if (best != null) return { start: best, end: best + quote.length, exact: true };
  }

  // No exact quote hit. Try the position hint as a last resort: look in a window
  // around the stored offset for the best fuzzy alignment of the quote.
  if (selector.textPosition && Number.isInteger(selector.textPosition.start)) {
    const approx = fuzzyNear(text, quote, selector.textPosition.start);
    if (approx) return { ...approx, exact: false };
  }

  return null; // orphan
}

/** Convenience wrapper that labels the outcome. */
export function resolveAnchor(text, selector) {
  const range = relocate(text, selector);
  if (!range) return { status: "orphaned", range: null };
  return { status: range.exact ? "exact" : "approximate", range };
}

// --- helpers ---------------------------------------------------------------

function allIndexesOf(haystack, needle) {
  const out = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

// How many trailing prefix chars and leading suffix chars match around a hit.
function contextScore(text, start, quote, prefix, suffix) {
  const before = text.slice(Math.max(0, start - prefix.length), start);
  const after = text.slice(start + quote.length, start + quote.length + suffix.length);
  return commonSuffix(before, prefix) + commonPrefix(after, suffix);
}

function commonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
function commonSuffix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

// Slide a window near `approxStart` looking for the offset whose substring is
// closest to `quote` by character overlap. Cheap and good enough for re-anchoring
// after small edits; a production build can swap in a proper diff/bitap matcher.
function fuzzyNear(text, quote, approxStart, window = 80) {
  const from = Math.max(0, approxStart - window);
  const to = Math.min(text.length - quote.length, approxStart + window);
  let best = null;
  let bestSim = 0;
  for (let s = from; s <= to; s++) {
    const candidate = text.slice(s, s + quote.length);
    const sim = similarity(candidate, quote);
    if (sim > bestSim) { bestSim = sim; best = s; }
  }
  if (best != null && bestSim >= 0.75) return { start: best, end: best + quote.length };
  return null;
}

function similarity(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / Math.max(a.length, b.length);
}
