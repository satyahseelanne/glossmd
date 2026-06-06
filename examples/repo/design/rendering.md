# Rendering

Gloss renders documents from their markdown source on every load. The
**rendered text** is the canonical surface for anchoring: quotes captured by
reviewers refer to what they see, not to the underlying syntax.

## Parser

We use `marked` with default options. Anything CommonMark-compatible should
render. The parser output is injected as an HTML string so we can post-process
the DOM and decorate anchor spans without re-traversing a React tree.

## Decoration pass

After each render, the app walks every thread's stored selector and re-locates
it in the current rendered plaintext. Located ranges are wrapped in
`<span class="anchor" data-thread="…">` so they are clickable and visually
distinct from the surrounding prose.

## Orphans

If a quoted span no longer appears in the rendered text — because the document
was edited after the comment was written — the thread is flagged as orphaned
and surfaced in the sidebar separately. Nothing is ever silently dropped.
