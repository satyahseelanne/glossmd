// test/commit.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ulid, createThread, addComment } from "@gloss/core";
import { MemoryHost, asReadHost } from "../src/host.js";
import { commitAction } from "../src/commit.js";
import { loadReviews } from "../src/read.js";
import { logPath } from "../src/paths.js";

const A = { id: "u_a", name: "Asha" };
const B = { id: "u_b", name: "Dev" };
const DOC = "design.md";
const anchor = { commit: "9f3c1ab", file: DOC, quote: "portable by default" };

function mkThread(body) {
  const id = ulid();
  return createThread({ id, actor: A, ts: new Date().toISOString(), anchor, body });
}

test("commitAction writes the action file and round-trips through the read path", async () => {
  const host = new MemoryHost();
  host.init("main", { "design.md": "# Design\n" });

  const action = mkThread("first comment");
  const { commitSha } = await commitAction(host, { branch: "main", docPath: DOC, action });
  assert.ok(commitSha);

  const files = await host.snapshot("main");
  assert.ok(logPath(DOC, action.id) in files, "action file should exist in the tree");

  const state = await loadReviews(asReadHost(host, "main"), DOC);
  assert.equal(Object.keys(state.threads).length, 1);
  assert.equal(state.threads[action.id].comments[0].body, "first comment");
});

test("a stale ref triggers a transparent retry, not a failure", async () => {
  const host = new MemoryHost();
  host.init("main", {});

  // Monkeypatch updateRef to reject the very first attempt as non-fast-forward,
  // simulating someone else committing between our read and write.
  const realUpdate = host.updateRef.bind(host);
  let rejectedOnce = false;
  host.updateRef = async (branch, expected, next) => {
    if (!rejectedOnce) { rejectedOnce = true; return { ok: false }; }
    return realUpdate(branch, expected, next);
  };

  const action = mkThread("survives a stale ref");
  const { attempts } = await commitAction(host, { branch: "main", docPath: DOC, action });
  assert.ok(attempts >= 2, "should have retried at least once");

  const state = await loadReviews(asReadHost(host, "main"), DOC);
  assert.equal(state.threads[action.id].comments[0].body, "survives a stale ref");
});

test("concurrent commits to one branch: no lost update (the ULID payoff)", async () => {
  const host = new MemoryHost();
  host.init("main", {});

  // Two reviewers each read the SAME head, then race to push. The loser hits a
  // non-fast-forward, rebases onto the winner, and retries. Because each action
  // is a uniquely-named file, the rebase is automatic — no conflict.
  const a1 = createThread({ id: ulid(), actor: A, ts: new Date().toISOString(), anchor, body: "from Asha" });
  const b1 = addComment({ id: ulid(), actor: B, ts: new Date().toISOString(), thread_id: a1.thread_id, body: "from Dev" });

  await Promise.all([
    commitAction(host, { branch: "main", docPath: DOC, action: a1 }),
    commitAction(host, { branch: "main", docPath: DOC, action: b1 }),
  ]);

  const files = await host.snapshot("main");
  assert.ok(logPath(DOC, a1.id) in files, "Asha's action survived");
  assert.ok(logPath(DOC, b1.id) in files, "Dev's action survived");

  const state = await loadReviews(asReadHost(host, "main"), DOC);
  assert.equal(state.threads[a1.thread_id].comments.length, 2, "both comments present after the race");
});

test("many racing writers all land", async () => {
  const host = new MemoryHost();
  host.init("main", {});
  const N = 12;
  const actions = Array.from({ length: N }, (_, i) =>
    createThread({ id: ulid(), actor: A, ts: new Date(Date.now() + i).toISOString(), anchor, body: `c${i}` })
  );
  await Promise.all(actions.map((action) => commitAction(host, { branch: "main", docPath: DOC, action })));

  const state = await loadReviews(asReadHost(host, "main"), DOC);
  assert.equal(Object.keys(state.threads).length, N, "every racing writer's thread is present");
});
