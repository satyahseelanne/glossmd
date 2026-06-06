// @gloss/anchor — src/highlight.js
//
// The inverse of capture.js: given char ranges already re-located by relocate.js,
// decorate the *rendered* DOM so each anchored span is visible and clickable. Runs
// against the same rendered plaintext model relocate works in — character offsets
// into `root.textContent`, walking text nodes — so the offsets line up exactly.
//
// A single anchor can straddle element boundaries (a **bold** word inside the
// quote splits the text into several text nodes), so one range may produce several
// adjacent <span class="anchor"> wrappers. They share the same data-thread, so the
// UI still treats them as one anchor. Kept DOM-only and framework-free: a VS Code
// webview would reuse it unchanged.

/**
 * @typedef {object} HighlightRange
 * @property {string} threadId   - thread this span belongs to
 * @property {number} start      - inclusive char offset into root.textContent
 * @property {number} end        - exclusive char offset
 * @property {"exact"|"approximate"|"resolved"|"orphaned"} [status]
 * @property {string|number} [pin] - small badge label (e.g. the anchor number, or ✓)
 */

const SPAN_CLASS = "anchor";

/**
 * Wrap each range in inline anchor spans. Mutates `root` in place.
 *
 * Safe to call after every render: it only ever wraps text nodes, and the caller
 * re-runs it on fresh markdown HTML (which has no .anchor spans yet). Returns a
 * cleanup that unwraps everything it added, restoring the original text nodes.
 *
 * @param {HTMLElement} root - the rendered document container
 * @param {HighlightRange[]} ranges
 * @param {(threadId: string) => void} [onClick] - invoked when a span is clicked
 * @returns {() => void} cleanup
 */
export function highlightRanges(root, ranges, onClick) {
  if (!root || !ranges || ranges.length === 0) return () => {};

  // Apply longest-first so that when two anchors overlap, the earlier (outer) one
  // doesn't fragment the other's offsets mid-pass. Within equal length, by start.
  const ordered = [...ranges]
    .filter((r) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.end > r.start)
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);

  const added = [];
  for (const r of ordered) {
    for (const seg of textSegmentsInRange(root, r.start, r.end)) {
      const span = wrapSegment(seg, r);
      if (!span) continue;
      if (onClick) span.addEventListener("click", (e) => { e.stopPropagation(); onClick(r.threadId); });
      added.push(span);
    }
  }

  return function cleanup() {
    for (const span of added) unwrap(span);
  };
}

/**
 * Toggle the active styling on every span belonging to `threadId` (and clear it
 * from the rest). Cheap to call on selection changes without re-wrapping.
 * @param {HTMLElement} root
 * @param {string|null} threadId
 */
export function setActiveHighlight(root, threadId) {
  for (const span of root.querySelectorAll(`.${SPAN_CLASS}`)) {
    span.classList.toggle("active", threadId != null && span.dataset.thread === threadId);
  }
}

// --- internals -------------------------------------------------------------

// Find the text-node sub-ranges covered by [start, end) in root.textContent order.
// Returns [{ node, from, to }] where from/to are offsets within that text node.
//
// IMPORTANT: pin nodes (the small badges we inject inside .anchor spans) are
// decoration, not source text — they must not advance the character counter or
// the offsets for *subsequent* ranges in the same pass will drift by N pins.
function textSegmentsInRange(root, start, end) {
  const out = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    { acceptNode: (n) => (isInsidePin(n, root) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) },
  );
  let pos = 0;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    pos = nodeEnd;

    // Skip text that's already inside an anchor span (overlap from an earlier,
    // larger range) — don't double-wrap. We still count its length toward pos
    // because the anchored text *is* part of the source.
    if (nodeStart >= end) break;
    if (nodeEnd <= start) continue;
    if (isInsideAnchor(node, root)) continue;

    const from = Math.max(0, start - nodeStart);
    const to = Math.min(len, end - nodeStart);
    if (to > from) out.push({ node, from, to });
  }
  return out;
}

function isInsideAnchor(node, root) {
  for (let p = node.parentNode; p && p !== root; p = p.parentNode) {
    if (p.nodeType === 1 && p.classList.contains(SPAN_CLASS)) return true;
  }
  return false;
}

function isInsidePin(node, root) {
  for (let p = node.parentNode; p && p !== root; p = p.parentNode) {
    if (p.nodeType === 1 && p.classList.contains("pin")) return true;
  }
  return false;
}

function wrapSegment({ node, from, to }, range) {
  // Split the text node so `node` holds exactly the [from, to) slice.
  let target = node;
  if (from > 0) target = target.splitText(from);
  if (to - from < target.textContent.length) target.splitText(to - from);

  const doc = target.ownerDocument;
  const span = doc.createElement("span");
  span.className = statusClass(range.status);
  span.dataset.thread = range.threadId;
  target.parentNode.insertBefore(span, target);
  span.appendChild(target);

  if (range.pin != null && range.pin !== "") {
    const pin = doc.createElement("span");
    pin.className = "pin";
    pin.textContent = String(range.pin);
    span.appendChild(pin);
  }
  return span;
}

function statusClass(status) {
  if (status === "resolved") return `${SPAN_CLASS} resolved`;
  if (status === "orphaned") return `${SPAN_CLASS} orphaned`;
  if (status === "approximate") return `${SPAN_CLASS} approximate`;
  return SPAN_CLASS;
}

// Restore a wrapped span back to a plain text node, dropping the pin badge.
function unwrap(span) {
  const parent = span.parentNode;
  if (!parent) return;
  const pin = span.querySelector(":scope > .pin");
  if (pin) pin.remove();
  while (span.firstChild) parent.insertBefore(span.firstChild, span);
  parent.removeChild(span);
  parent.normalize(); // re-merge the split text nodes
}
