// @gloss/git — src/commit.js
//
// The write path. Everyone reviews on the same branch, so a comment is committed
// straight to it. Because each action is a uniquely ULID-named file, two
// reviewers committing at once never touch the same path — so the only thing
// that can go wrong is the branch advancing under us between read and write,
// which updateRef detects. We just rebase onto the new head and retry. The retry
// never hits a real conflict; it rebuilds the snapshot on the new head.

import { logPath, checkpointPath } from "./paths.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Commit a single action file to the branch with optimistic-concurrency retry.
 *
 * @param {import("./host.js").HostAdapter} host
 * @param {object} args
 * @param {string} args.branch
 * @param {string} args.docPath
 * @param {object} args.action   - an action object from @gloss/core
 * @param {number} [args.maxRetries=8]
 * @returns {Promise<{commitSha:string, attempts:number}>}
 */
export async function commitAction(host, { branch, docPath, action, maxRetries = 8 }) {
  const path = logPath(docPath, action.id);
  const content = JSON.stringify(action, null, 2);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const head = await host.getRef(branch);            // 1. read head
    const newSha = await host.createCommit(head, [     // 2-3. build tree+commit on head
      { op: "add", path, content },
    ]);
    const res = await host.updateRef(branch, head, newSha); // 4. CAS the ref
    if (res.ok) return { commitSha: newSha, attempts: attempt };
    await sleep(backoff(attempt));                     // 5. moved → rebase + retry
  }
  throw new Error(`commitAction: exceeded ${maxRetries} retries on ${branch} (contention)`);
}

/**
 * Commit document content itself (the reviewed .md), not review metadata. Same
 * pull-rebase-push CAS loop as commitAction — but unlike action files (uniquely
 * ULID-named, never colliding), the doc is a single shared path, so a concurrent
 * edit to the *same* file does race: updateRef rejects the non-fast-forward and
 * we retry on the new head. The retry re-commits the editor's content as-is,
 * so a true simultaneous edit is last-writer-wins on this path. The branch queue
 * in the server keeps our own writes from racing each other.
 *
 * @param {import("./host.js").HostAdapter} host
 * @param {object} args
 * @param {string} args.branch
 * @param {string} args.path     - repo path of the document, e.g. "design/design.md"
 * @param {string} args.content  - the full new file contents
 * @param {number} [args.maxRetries=8]
 * @returns {Promise<{commitSha:string, attempts:number}>}
 */
export async function commitFile(host, { branch, path, content, maxRetries = 8 }) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const head = await host.getRef(branch);
    const newSha = await host.createCommit(head, [{ op: "add", path, content }]);
    const res = await host.updateRef(branch, head, newSha);
    if (res.ok) return { commitSha: newSha, attempts: attempt };
    await sleep(backoff(attempt));
  }
  throw new Error(`commitFile: exceeded ${maxRetries} retries on ${branch} (contention)`);
}

/**
 * Commit a compaction: write a new checkpoint and remove the folded log files in
 * one commit, so the working tree's _log/ only ever holds un-folded actions.
 *
 * @param {import("./host.js").HostAdapter} host
 * @param {object} args
 * @param {string} args.branch
 * @param {string} args.docPath
 * @param {object} args.checkpoint        - checkpoint object from @gloss/core
 * @param {string[]} args.foldedLogPaths  - repo paths of action files to delete
 * @param {string[]} [args.removePaths]   - extra paths to delete in the same
 *   commit (e.g. the superseded checkpoint, for atomic GC)
 * @param {number} [args.maxRetries=8]
 */
export async function commitCheckpoint(host, { branch, docPath, checkpoint, foldedLogPaths, removePaths = [], maxRetries = 8 }) {
  const ops = [
    { op: "add", path: checkpointPath(docPath, checkpoint.id), content: JSON.stringify(checkpoint, null, 2) },
    ...foldedLogPaths.map((p) => ({ op: "remove", path: p })),
    ...removePaths.map((p) => ({ op: "remove", path: p })),
  ];
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const head = await host.getRef(branch);
    const newSha = await host.createCommit(head, ops);
    const res = await host.updateRef(branch, head, newSha);
    if (res.ok) return { commitSha: newSha, attempts: attempt };
    await sleep(backoff(attempt));
  }
  throw new Error(`commitCheckpoint: exceeded ${maxRetries} retries on ${branch}`);
}

function backoff(attempt) {
  // small jittered backoff so colliding writers don't lock-step
  return Math.min(50, 2 ** attempt) * (0.5 + Math.random());
}
