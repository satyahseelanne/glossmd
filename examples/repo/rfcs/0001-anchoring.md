# RFC 0001 — Anchoring

We adopt the W3C Web Annotation `TextQuoteSelector` shape for every anchor:

```json
{
  "quote": "the selected text",
  "prefix": "up to 32 chars before",
  "suffix": "up to 32 chars after",
  "textPosition": { "start": 1234, "end": 1267 }
}
```

The position hint is advisory only — the source of truth is the quote plus
its surrounding context. On load, the resolver tries:

1. exact unique match of `quote` in the rendered text
2. multi-hit disambiguation using `prefix` / `suffix` overlap
3. a small fuzzy window around `textPosition` as a last resort
4. otherwise: orphaned

This shape is intentionally portable. Any tool that can produce or consume
W3C-style selectors can write or read Gloss comments without further
knowledge of the protocol.
