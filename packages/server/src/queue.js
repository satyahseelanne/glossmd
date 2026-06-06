// @gloss/server — src/queue.js
//
// A per-key serializer. The commit loop in @gloss/git already survives the
// branch head moving under it (optimistic CAS + rebase-retry), but when *our
// own* server fires several writes at the same branch concurrently they all
// read the same head, all collide on updateRef, and burn retries (and host
// rate limit) thrashing against each other. Serializing per branch turns that
// thundering herd into an orderly line: each write sees the previous one's new
// head, so the common case is a single attempt.
//
// Keyed so unrelated branches still run in parallel. Pure and dependency-free.

/**
 * @returns {{ run: <T>(key: string, task: () => Promise<T>) => Promise<T>, depth: (key:string)=>number }}
 */
export function createBranchQueue() {
  /** @type {Map<string, Promise<unknown>>} tail of each key's chain */
  const tails = new Map();
  /** @type {Map<string, number>} outstanding tasks per key, for observability */
  const counts = new Map();

  function run(key, task) {
    counts.set(key, (counts.get(key) ?? 0) + 1);

    const prev = tails.get(key) ?? Promise.resolve();
    // Chain after the previous task regardless of whether it resolved or
    // rejected — one failed write must not wedge the branch's queue.
    const result = prev.then(task, task);

    // The stored tail must never reject (that would poison the next .then), so
    // park a swallowed copy as the chain tail.
    const tail = result.then(
      () => {},
      () => {},
    ).finally(() => {
      counts.set(key, counts.get(key) - 1);
      if (counts.get(key) === 0) {
        counts.delete(key);
        // Only clear the tail if no one chained after us in the meantime.
        if (tails.get(key) === tail) tails.delete(key);
      }
    });
    tails.set(key, tail);

    return result;
  }

  function depth(key) {
    return counts.get(key) ?? 0;
  }

  return { run, depth };
}
