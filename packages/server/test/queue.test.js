// @gloss/server — test/queue.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBranchQueue } from "../src/queue.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

test("tasks for one key run strictly in series, in submission order", async () => {
  const q = createBranchQueue();
  const order = [];
  const started = [];

  const mk = (label, ms) => async () => {
    started.push(label);
    await new Promise((r) => setTimeout(r, ms));
    order.push(label);
    return label;
  };

  // Submit three at once; the later ones must not start until earlier finish.
  const p1 = q.run("main", mk("a", 30));
  const p2 = q.run("main", mk("b", 5));
  const p3 = q.run("main", mk("c", 5));

  await tick();
  assert.deepEqual(started, ["a"], "only the first task starts immediately");

  const results = await Promise.all([p1, p2, p3]);
  assert.deepEqual(results, ["a", "b", "c"], "each call resolves with its own value");
  assert.deepEqual(order, ["a", "b", "c"], "completion order matches submission order");
});

test("different keys run concurrently", async () => {
  const q = createBranchQueue();
  const started = [];

  const mk = (label) => async () => {
    started.push(label);
    await new Promise((r) => setTimeout(r, 20));
  };

  const a = q.run("branch-1", mk("1"));
  const b = q.run("branch-2", mk("2"));

  await tick();
  assert.deepEqual(started.sort(), ["1", "2"], "both keys start without waiting on each other");
  await Promise.all([a, b]);
});

test("a rejected task does not wedge the queue for that key", async () => {
  const q = createBranchQueue();
  const order = [];

  const boom = q.run("main", async () => {
    order.push("boom");
    throw new Error("kaboom");
  });
  const after = q.run("main", async () => {
    order.push("after");
    return "ok";
  });

  await assert.rejects(boom, /kaboom/);
  assert.equal(await after, "ok", "the next task still runs after a failure");
  assert.deepEqual(order, ["boom", "after"]);
});

test("depth tracks outstanding work and drains to zero", async () => {
  const q = createBranchQueue();
  let release;
  const gate = new Promise((r) => (release = r));

  const p1 = q.run("main", async () => { await gate; });
  const p2 = q.run("main", async () => { await gate; });

  assert.equal(q.depth("main"), 2, "two tasks queued");
  release();
  await Promise.all([p1, p2]);
  await tick();
  assert.equal(q.depth("main"), 0, "queue drains back to zero");
});
