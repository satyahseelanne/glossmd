// @gloss/git — src/github.js
//
// Real HostAdapter over the GitHub REST API. Sketch: the method shapes and
// endpoints are correct, but this needs a network and a token, so it isn't
// exercised by the offline test suite. The commit engine in commit.js drives it
// unchanged — that's the point of the HostAdapter seam.
//
// Auth: `token` is the reviewer's OAuth token, held server-side. All calls act
// as the reviewer, so repo permissions are the host's concern, not ours.

const API = "https://api.github.com";

export class GitHubHost {
  /** @param {{owner:string, repo:string, token:string, fetch?:typeof fetch}} cfg */
  constructor({ owner, repo, token, fetch: f = fetch }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
    this._fetch = f;
  }

  async _api(path, init = {}) {
    const res = await this._fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`GitHub ${init.method ?? "GET"} ${path} → ${res.status}: ${body}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  base() { return `/repos/${this.owner}/${this.repo}`; }

  async getRef(branch) {
    try {
      const r = await this._api(`${this.base()}/git/ref/heads/${branch}`);
      return r.object.sha;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async getCommit(sha) {
    const c = await this._api(`${this.base()}/git/commits/${sha}`);
    // NOTE: GitHub trees are fetched lazily; a production build reads the tree
    // and only the .gloss/ blobs it needs rather than the whole snapshot.
    return { sha: c.sha, parent: c.parents[0]?.sha ?? null, files: {} };
  }

  async createCommit(parentSha, ops) {
    // 1. base tree = parent's tree (or empty)
    let baseTree = null;
    if (parentSha) {
      const pc = await this._api(`${this.base()}/git/commits/${parentSha}`);
      baseTree = pc.tree.sha;
    }
    // 2. blobs for adds
    const tree = [];
    for (const op of ops) {
      if (op.op === "add") {
        const blob = await this._api(`${this.base()}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: op.content, encoding: "utf-8" }),
        });
        tree.push({ path: op.path, mode: "100644", type: "blob", sha: blob.sha });
      } else if (op.op === "remove") {
        tree.push({ path: op.path, mode: "100644", type: "blob", sha: null }); // delete
      }
    }
    // 3. new tree + commit
    const newTree = await this._api(`${this.base()}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTree, tree }),
    });
    const commit = await this._api(`${this.base()}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: "gloss: review activity",
        tree: newTree.sha,
        parents: parentSha ? [parentSha] : [],
      }),
    });
    return commit.sha;
  }

  async updateRef(branch, expectedSha, newSha) {
    // force:false → GitHub rejects a non-fast-forward update, which is exactly
    // the optimistic-concurrency signal the commit engine retries on.
    try {
      await this._api(`${this.base()}/git/refs/heads/${branch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: newSha, force: false }),
      });
      return { ok: true };
    } catch (e) {
      if (e.status === 422) return { ok: false }; // not a fast-forward → rebase + retry
      throw e;
    }
  }

  // Read path (Contents API). Good enough for v1; large dirs should use the Git
  // Trees API with recursive=1 instead. `ref` pins reads to a branch/sha so the
  // read path matches whichever branch the reviewer is on.
  async listDir(dir, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    try {
      const items = await this._api(`${this.base()}/contents/${encodeURI(dir)}${q}`);
      return Array.isArray(items) ? items.map((i) => i.path) : [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  async readFile(path, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    try {
      const item = await this._api(`${this.base()}/contents/${encodeURI(path)}${q}`);
      return Buffer.from(item.content, "base64").toString("utf-8");
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Bind this host to a branch as a ReadHost ({listDir, readFile}) for the
   * shared read path in @gloss/git's readReviewFiles — the same shape the
   * MemoryHost's asReadHost() produces, so both backends drive one code path.
   */
  asReadHost(branch) {
    return {
      listDir: (dir) => this.listDir(dir, branch),
      readFile: (path) => this.readFile(path, branch),
    };
  }

  /**
   * Every blob path on a branch, via the Git Trees API (recursive). Used by the
   * server's file browser. Cheaper than walking the Contents API per directory.
   */
  async listPaths(branch) {
    const head = await this.getRef(branch);
    if (!head) return [];
    const commit = await this._api(`${this.base()}/git/commits/${head}`);
    const tree = await this._api(
      `${this.base()}/git/trees/${commit.tree.sha}?recursive=1`,
    );
    return (tree.tree ?? []).filter((t) => t.type === "blob").map((t) => t.path);
  }
}
