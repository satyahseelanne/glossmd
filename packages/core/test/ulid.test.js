// test/ulid.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ulidFactory, ulidTime } from "../src/ulid.js";

test("ulid is 26 chars and time-sortable across milliseconds", () => {
  let t = 1000;
  const gen = ulidFactory({ now: () => (t += 1), rng: () => 0.5 });
  const ids = Array.from({ length: 50 }, gen);
  ids.forEach((id) => assert.equal(id.length, 26));
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "ids minted over increasing time must already be in sort order");
});

test("ulid is monotonic within a single millisecond", () => {
  let rngState = 0;
  // fixed clock; rng advances so the seed differs but monotonic increment still
  // guarantees order even if the random seed were identical
  const gen = ulidFactory({ now: () => 5000, rng: () => (rngState = (rngState + 0.1) % 1) });
  const ids = Array.from({ length: 100 }, gen);
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "ids minted in the same ms must still sort in mint order");
  assert.equal(new Set(ids).size, ids.length, "no collisions");
});

test("ulidTime round-trips the encoded timestamp", () => {
  const when = 1_700_000_000_000;
  const gen = ulidFactory({ now: () => when, rng: () => 0.42 });
  assert.equal(ulidTime(gen()), when);
});
