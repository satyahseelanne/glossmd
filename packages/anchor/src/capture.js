// @gloss/anchor — src/capture.js
//
// Browser-side: turn the reviewer's current text selection into a stored
// selector. Runs against the *rendered* DOM, so the quote is what the reviewer
// actually sees, not the markdown source. Kept apart from relocate.js so the
// matching logic stays DOM-free and testable.

const CONTEXT = 32; // chars of prefix/suffix to capture

/**
 * Build a TextQuoteSelector from the current window selection within `root`.
 * @param {Node} root - the rendered document container
 * @param {string} commit - the commit SHA the document is currently at
 * @param {string} file - the document's repo path
 * @returns {object|null} an anchor, or null if there's no usable selection
 */
export function captureSelection(root, commit, file) {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const full = root.textContent ?? "";
  const quote = sel.toString();
  if (quote.trim().length < 2) return null;

  const start = charOffset(root, range.startContainer, range.startOffset);
  const end = start + quote.length;

  return {
    commit,
    file,
    quote,
    prefix: full.slice(Math.max(0, start - CONTEXT), start),
    suffix: full.slice(end, end + CONTEXT),
    textPosition: { start, end },
  };
}

// Character offset of (node, offset) within root.textContent, walking text nodes.
function charOffset(root, node, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let count = 0;
  let n;
  while ((n = walker.nextNode())) {
    if (n === node) return count + offset;
    count += n.textContent.length;
  }
  return count;
}
