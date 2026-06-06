// @gloss/git — src/host.js
//
// A HostAdapter is the narrow interface the commit engine needs from a git host
// (GitHub/GitLab API, or local git, or the in-memory fake below). It is
// deliberately tiny: read a branch head, snapshot a commit, create a commit that
// adds/removes files, and update a ref with optimistic concurrency.
//
// The key method is updateRef(branch, expectedSha, newSha): it MUST fail if the
// branch no longer points at expectedSha. That single compare-and-set is what
// turns "everyone commits to one branch" into a safe pull-rebase-push loop.

/**
 * @typedef {object} HostAdapter
 * @property {(branch: string) => Promise<string|null>} getRef
 *   current head SHA of the branch, or null if it doesn't exist
 * @property {(sha: string) => Promise<{sha:string, parent:string|null, files:Record<string,string>}>} getCommit
 * @property {(parentSha: string|null, ops: FileOp[]) => Promise<string>} createCommit
 *   build a new commit snapshot from parent + file ops; returns the new SHA
 * @property {(branch: string, expectedSha: string|null, newSha: string) => Promise<{ok:boolean}>} updateRef
 *   atomically advance the branch; ok:false means it moved (non-fast-forward)
 */

/**
 * @typedef {object} FileOp
 * @property {"add"|"remove"} op
 * @property {string} path
 * @property {string} [content]
 */

import { createHash } from "node:crypto";

const sha = (obj) => createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 12);

/**
 * In-memory HostAdapter. Models a content-addressed commit graph with snapshot
 * files and atomic ref updates — enough to exercise the commit engine and prove
 * the concurrency behaviour without a network. Also handy as a real local/dev
 * backend seeded from a sample repo.
 */
export class MemoryHost {
  constructor() {
    this.commits = new Map(); // sha -> {sha, parent, files}
    this.refs = new Map();    // branch -> sha
    // optional instrumentation for tests
    this.refUpdateAttempts = 0;
    this.refUpdateConflicts = 0;
  }

  /** Seed the host with an initial commit containing `files`. */
  init(branch, files = {}) {
    const commit = { sha: sha({ parent: null, files }), parent: null, files: { ...files } };
    this.commits.set(commit.sha, commit);
    this.refs.set(branch, commit.sha);
    return commit.sha;
  }

  async getRef(branch) {
    return this.refs.get(branch) ?? null;
  }

  async getCommit(s) {
    const c = this.commits.get(s);
    if (!c) throw new Error(`unknown commit ${s}`);
    return { sha: c.sha, parent: c.parent, files: { ...c.files } };
  }

  async createCommit(parentSha, ops) {
    const parent = parentSha ? this.commits.get(parentSha) : { files: {} };
    if (parentSha && !parent) throw new Error(`unknown parent ${parentSha}`);
    const files = { ...parent.files };
    for (const op of ops) {
      if (op.op === "add") files[op.path] = op.content;
      else if (op.op === "remove") delete files[op.path];
      else throw new Error(`bad file op ${op.op}`);
    }
    const commit = { sha: sha({ parent: parentSha, files, n: Math.random() }), parent: parentSha, files };
    this.commits.set(commit.sha, commit);
    return commit.sha;
  }

  async updateRef(branch, expectedSha, newSha) {
    this.refUpdateAttempts++;
    const current = this.refs.get(branch) ?? null;
    if (current !== expectedSha) {
      this.refUpdateConflicts++;
      return { ok: false, current }; // non-fast-forward: caller must rebase + retry
    }
    this.refs.set(branch, newSha);
    return { ok: true };
  }

  /** Test/dev helper: read the file map at the current branch head. */
  async snapshot(branch) {
    const head = await this.getRef(branch);
    if (!head) return {};
    return (await this.getCommit(head)).files;
  }
}

/**
 * Bind a MemoryHost + branch to the ReadHost interface (listDir/readFile) used
 * by the read path. Reads reflect the current branch head.
 */
export function asReadHost(memHost, branch) {
  return {
    async listDir(dir) {
      const files = await memHost.snapshot(branch);
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
    async readFile(path) {
      const files = await memHost.snapshot(branch);
      return path in files ? files[path] : null;
    },
  };
}
