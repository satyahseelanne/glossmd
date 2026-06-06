// test/reducer.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createThread,
  addComment,
  editComment,
  deleteComment,
  resolveThread,
  reopenThread,
} from "../src/actions.js";
import { reduce, canonical } from "../src/reducer.js";
import { compact, load } from "../src/checkpoint.js";
import { ulidFactory } from "../src/ulid.js";

const A = { id: "u_a", name: "Asha" };
const B = { id: "u_b", name: "Dev" };
const anchor = { commit: "9f3c1ab", file: "design.md", quote: "portable by default", prefix: "be ", suffix: ", readable" };

// Deterministic actions with explicit ids/timestamps so tests don't depend on
// wall-clock. ts strings are ISO-ish and lexically == chronologically ordered;
// ids are lexically ordered too.
const T = createThread({ id: "01A", actor: A, ts: "2026-06-05T10:00:00.000Z", anchor, body: "v1" });
const R = addComment({ id: "01B", actor: B, ts: "2026-06-05T10:05:00.000Z", thread_id: "01A", body: "a reply" });
const E1 = editComment({ id: "01E1", actor: A, ts: "2026-06-05T10:10:00.000Z", target: "01A", body: "v2" });
const E2 = editComment({ id: "01E2", actor: A, ts: "2026-06-05T10:20:00.000Z", target: "01A", body: "v3-latest" });
const RES = resolveThread({ id: "01R", actor: B, ts: "2026-06-05T10:30:00.000Z", thread_id: "01A" });
const REO = reopenThread({ id: "01O", actor: A, ts: "2026-06-05T10:40:00.000Z", thread_id: "01A" });

const firstComment = (state) => state.threads["01A"].comments[0];

test("create + reply builds a thread with comments in creation order", () => {
  const s = reduce([T, R]);
  const t = s.threads["01A"];
  assert.equal(t.status, "open");
  assert.equal(t.comments.length, 2);
  assert.equal(t.comments[0].id, "01A");
  assert.equal(t.comments[0].body, "v1");
  assert.equal(t.comments[1].id, "01B");
  assert.equal(t.anchor.quote, "portable by default");
});

test("reduce is deterministic regardless of action order", () => {
  const log = [T, R, E1, E2, RES, REO];
  const reference = canonical(reduce(log));
  // a handful of shuffles must all agree
  const shuffles = [
    [REO, RES, E2, E1, R, T],
    [E2, T, REO, R, E1, RES],
    [RES, E1, T, REO, E2, R],
  ];
  for (const sh of shuffles) {
    assert.deepEqual(canonical(reduce(sh)), reference, "shuffled order changed the result");
  }
});

test("edit_comment: latest (ts,id) wins no matter the processing order", () => {
  assert.equal(firstComment(reduce([T, E1, E2])).body, "v3-latest");
  assert.equal(firstComment(reduce([T, E2, E1])).body, "v3-latest", "older edit must not clobber newer");
  assert.equal(firstComment(reduce([T, E1, E2])).edited, true);
});

test("resolve / reopen: latest status decision wins", () => {
  assert.equal(reduce([T, RES]).threads["01A"].status, "resolved");
  assert.equal(reduce([T, RES, REO]).threads["01A"].status, "open");
  assert.equal(reduce([T, REO, RES]).threads["01A"].status, "open", "reopen is later, must win");
});

test("delete_comment tombstones, and a stale edit underneath does not revive it", () => {
  const DEL = deleteComment({ id: "01D", actor: A, ts: "2026-06-05T10:25:00.000Z", target: "01A" });
  const s = reduce([T, E2, DEL]);
  assert.equal(firstComment(s).deleted, true);
  // a later edit updates body but does not un-delete (no undelete action exists)
  const E3 = editComment({ id: "01E3", actor: A, ts: "2026-06-05T10:50:00.000Z", target: "01A", body: "v4" });
  const s2 = reduce([T, E2, DEL, E3]);
  assert.equal(firstComment(s2).deleted, true);
  assert.equal(firstComment(s2).body, "v4");
});

// ---- the load-bearing guarantee --------------------------------------------

test("late arrival self-heals: an older edit merging after a checkpoint cannot clobber a newer one", () => {
  const gen = ulidFactory({ now: () => 9_000_000, rng: () => 0.3 });
  // Checkpoint captured the thread with the NEWER edit (E2 -> "v3-latest").
  const { checkpoint } = compact(gen, "2026-06-05T11:00:00.000Z", [T, E2]);
  // Now the OLDER edit E1 ("v2", ts 10:10) finally merges into the branch and
  // lands in the log tail, i.e. it is folded ON TOP of the checkpoint.
  const healed = load(checkpoint, [E1]);
  assert.equal(firstComment(healed).body, "v3-latest", "stale edit overwrote the newer value");
  // And the result equals a full replay from zero.
  assert.equal(firstComment(reduce([T, E1, E2])).body, "v3-latest");
});

test("checkpoint idempotence: fold(checkpoint, tail) == replay(full) for every split", () => {
  const gen = ulidFactory({ now: () => 9_100_000, rng: () => 0.7 });
  const full = [T, R, E1, E2, RES, REO];
  const fromZero = canonical(reduce(full));

  // Split the log at several boundaries, including one that puts the NEWER edit
  // (E2) in the checkpoint while the OLDER edit (E1) arrives in the tail.
  const splits = [
    { folded: [T], tail: [R, E1, E2, RES, REO] },
    { folded: [T, R, E1], tail: [E2, RES, REO] },
    { folded: [T, E2], tail: [R, E1, RES, REO] },          // late older edit in tail
    { folded: [T, R, E1, E2, REO], tail: [RES] },          // resolve after reopen in tail
    { folded: full, tail: [] },                            // everything folded
  ];

  for (const { folded, tail } of splits) {
    const { checkpoint } = compact(gen, "2026-06-05T11:30:00.000Z", folded);
    const folded2 = canonical(load(checkpoint, tail));
    assert.deepEqual(folded2, fromZero, `split mismatch: folded=${folded.map((a) => a.id)}`);
  }
});

test("dangling actions are captured as orphans, not crashes", () => {
  const reply = addComment({ id: "01Z", actor: B, ts: "2026-06-05T12:00:00.000Z", thread_id: "does_not_exist", body: "hi" });
  const s = reduce([T, reply]);
  assert.equal(s.orphans.length, 1);
  assert.equal(s.orphans[0].reason, "missing_thread");
});
