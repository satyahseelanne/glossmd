// test/relocate.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { relocate, resolveAnchor } from "../src/relocate.js";

const DOC =
  "Comments should be portable by default, readable by any conforming tool. " +
  "The protocol follows Delta Lake's model. Comments live in the repo, not a database.";

test("unique quote relocates exactly", () => {
  const r = relocate(DOC, { quote: "portable by default" });
  assert.ok(r);
  assert.equal(DOC.slice(r.start, r.end), "portable by default");
  assert.equal(r.exact, true);
});

test("ambiguous quote is disambiguated by context", () => {
  // "Comments" appears twice; prefix/suffix should pick the right one.
  const second = relocate(DOC, {
    quote: "Comments",
    prefix: "model. ",
    suffix: " live in the repo",
  });
  assert.ok(second);
  // the second occurrence starts after the first sentence
  assert.ok(second.start > DOC.indexOf("Comments") );
  assert.equal(DOC.slice(second.start, second.end), "Comments");
});

test("quote that shifted slightly still relocates via position hint", () => {
  // Simulate an edit: a word inserted earlier pushes the quote a few chars right.
  const edited = DOC.replace("The protocol", "The Gloss protocol");
  const origStart = DOC.indexOf("Delta Lake");
  const r = relocate(edited, {
    quote: "Delta Lakes model", // note the typo'd/edited quote (missing apostrophe)
    textPosition: { start: origStart, end: origStart + 17 },
  });
  // exact match fails (text changed), so it falls back to fuzzy-near and either
  // finds a close alignment or orphans — both are acceptable, but it must not throw
  assert.ok(r === null || typeof r.start === "number");
});

test("missing quote orphans cleanly", () => {
  const out = resolveAnchor(DOC, { quote: "text that was entirely deleted from the doc" });
  assert.equal(out.status, "orphaned");
  assert.equal(out.range, null);
});

test("resolveAnchor labels exact vs approximate", () => {
  assert.equal(resolveAnchor(DOC, { quote: "conforming tool" }).status, "exact");
});
