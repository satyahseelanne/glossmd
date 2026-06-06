// @gloss/git — test/github.test.js
//
// Exercises GitHubHost's request/response shaping and the commit loop against a
// fake GitHub REST API (an injected `fetch`). No network, no token — but it
// drives exactly the code paths the live host uses: ref read, recursive tree
// listing, blob-decode reads, and the blob→tree→commit→CAS write sequence
// including the 422 non-fast-forward retry.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GitHubHost, commitAction, readReviewFiles } from "../src/index.js";

// --- a minimal in-memory GitHub the host can talk to ----------------------
class FakeGitHub {
  constructor() {
    this.refs = new Map();    // branch -> commitSha
    this.commits = new Map(); // sha -> { parents:[sha], treeSha }
    this.trees = new Map();   // sha -> Map(path -> blobSha)
    this.blobs = new Map();   // sha -> content string
    this.n = 0;
    this.failNextPatch = false;
    this.calls = [];          // observability for assertions
  }

  _id(prefix) { return `${prefix}${++this.n}`; }

  seed(branch, files) {
    const tree = new Map();
    for (const [path, content] of Object.entries(files)) {
      const b = this._id("b");
      this.blobs.set(b, content);
      tree.set(path, b);
    }
    const treeSha = this._id("t");
    this.trees.set(treeSha, tree);
    const commitSha = this._id("c");
    this.commits.set(commitSha, { parents: [], treeSha });
    this.refs.set(branch, commitSha);
  }

  // The injected fetch. Returns a Response-ish object the host's _api expects.
  fetch = async (urlStr, init = {}) => {
    const url = new URL(urlStr);
    const p = url.pathname;
    const method = init.method ?? "GET";
    this.calls.push(`${method} ${p}`);
    const body = init.body ? JSON.parse(init.body) : null;
    const ok = (obj, status = 200) => ({
      ok: true, status,
      json: async () => obj,
      text: async () => JSON.stringify(obj),
    });
    const fail = (status, msg = "err") => ({
      ok: false, status,
      json: async () => ({ message: msg }),
      text: async () => msg,
    });

    // GET refs/heads/{branch}
    let m = p.match(/\/git\/ref\/heads\/(.+)$/);
    if (m && method === "GET") {
      const sha = this.refs.get(decodeURIComponent(m[1]));
      return sha ? ok({ object: { sha } }) : fail(404);
    }

    // GET commits/{sha}
    m = p.match(/\/git\/commits\/(.+)$/);
    if (m && method === "GET") {
      const c = this.commits.get(m[1]);
      if (!c) return fail(404);
      return ok({ sha: m[1], parents: c.parents.map((s) => ({ sha: s })), tree: { sha: c.treeSha } });
    }

    // GET trees/{sha}?recursive=1
    m = p.match(/\/git\/trees\/([^/]+)$/);
    if (m && method === "GET") {
      const tree = this.trees.get(m[1]);
      if (!tree) return fail(404);
      const entries = [...tree.entries()].map(([path, sha]) => ({ path, type: "blob", sha }));
      return ok({ tree: entries });
    }

    // GET contents/{path}?ref=branch
    m = p.match(/\/contents\/(.+)$/);
    if (m && method === "GET") {
      const path = decodeURIComponent(m[1]);
      const ref = url.searchParams.get("ref");
      const tree = this.trees.get(this.commits.get(this.refs.get(ref))?.treeSha);
      if (!tree) return fail(404);
      if (tree.has(path)) {
        const content = this.blobs.get(tree.get(path));
        return ok({ content: Buffer.from(content, "utf-8").toString("base64"), encoding: "base64" });
      }
      // directory listing: immediate-or-deeper blobs under path/
      const prefix = path.endsWith("/") ? path : path + "/";
      const children = [...tree.keys()].filter((k) => k.startsWith(prefix));
      return children.length ? ok(children.map((path) => ({ path, type: "file" }))) : fail(404);
    }

    // POST blobs
    if (p.endsWith("/git/blobs") && method === "POST") {
      const sha = this._id("b");
      this.blobs.set(sha, body.content);
      return ok({ sha });
    }

    // POST trees
    if (p.endsWith("/git/trees") && method === "POST") {
      const base = body.base_tree ? new Map(this.trees.get(body.base_tree)) : new Map();
      for (const e of body.tree) {
        if (e.sha === null) base.delete(e.path);
        else base.set(e.path, e.sha);
      }
      const sha = this._id("t");
      this.trees.set(sha, base);
      return ok({ sha });
    }

    // POST commits
    if (p.endsWith("/git/commits") && method === "POST") {
      const sha = this._id("c");
      this.commits.set(sha, { parents: body.parents ?? [], treeSha: body.tree });
      return ok({ sha });
    }

    // PATCH refs/heads/{branch}
    m = p.match(/\/git\/refs\/heads\/(.+)$/);
    if (m && method === "PATCH") {
      if (this.failNextPatch) {
        this.failNextPatch = false;
        return fail(422, "not a fast-forward");
      }
      this.refs.set(decodeURIComponent(m[1]), body.sha);
      return ok({});
    }

    return fail(404, `unhandled ${method} ${p}`);
  };
}

function makeHost(seed = {}) {
  const gh = new FakeGitHub();
  gh.seed("main", seed);
  const host = new GitHubHost({ owner: "acme", repo: "docs", token: "t_test", fetch: gh.fetch });
  return { gh, host };
}

test("getRef returns the branch head, or null on 404", async () => {
  const { host } = makeHost({ "README.md": "# hi" });
  assert.equal(typeof (await host.getRef("main")), "string");
  assert.equal(await host.getRef("does-not-exist"), null);
});

test("listPaths walks the recursive tree and returns blob paths", async () => {
  const { host } = makeHost({
    "design/design.md": "# d",
    "rfcs/0001.md": "# r",
    "design/.gloss/design.md/_log/01ABC.json": "{}",
  });
  const paths = (await host.listPaths("main")).sort();
  assert.deepEqual(paths, ["design/.gloss/design.md/_log/01ABC.json", "design/design.md", "rfcs/0001.md"]);
});

test("readFile base64-decodes content, or null on 404", async () => {
  const { host } = makeHost({ "design/design.md": "# Heading\n\nbody" });
  assert.equal(await host.readFile("design/design.md", "main"), "# Heading\n\nbody");
  assert.equal(await host.readFile("nope.md", "main"), null);
});

test("asReadHost + readReviewFiles round-trips a seeded log", async () => {
  const action = {
    v: 1, id: "01HZZ0000000000000000T001", type: "create_thread",
    actor: { id: "u", name: "U" }, ts: "2026-06-05T00:00:00.000Z",
    thread_id: "01HZZ0000000000000000T001",
    anchor: { quote: "x" }, body: "hello",
  };
  const { host } = makeHost({
    "design/design.md": "# d",
    "design/.gloss/design.md/_log/01HZZ0000000000000000T001.json": JSON.stringify(action),
  });
  const { checkpoint, logTail } = await readReviewFiles(host.asReadHost("main"), "design/design.md");
  assert.equal(checkpoint, null);
  assert.equal(logTail.length, 1);
  assert.equal(logTail[0].type, "create_thread");
  assert.equal(logTail[0].body, "hello");
});

test("commitAction writes blob→tree→commit and advances the ref in one attempt", async () => {
  const { gh, host } = makeHost({ "design/design.md": "# d" });
  const before = await host.getRef("main");
  const action = {
    v: 1, id: "01HZZ0000000000000000T002", type: "create_thread",
    actor: { id: "u", name: "U" }, ts: "2026-06-05T00:00:01.000Z",
    thread_id: "01HZZ0000000000000000T002", anchor: { quote: "y" }, body: "b",
  };
  const { commitSha, attempts } = await commitAction(host, {
    branch: "main", docPath: "design/design.md", action,
  });
  assert.equal(attempts, 1);
  assert.notEqual(commitSha, before);
  assert.equal(await host.getRef("main"), commitSha);

  // the action file is now readable back through the read path
  const raw = await host.readFile("design/.gloss/design.md/_log/01HZZ0000000000000000T002.json", "main");
  assert.equal(JSON.parse(raw).body, "b");
  assert.ok(gh.calls.some((c) => c.startsWith("POST") && c.endsWith("/git/blobs")));
});

test("a 422 non-fast-forward triggers a transparent retry, not a failure", async () => {
  const { gh, host } = makeHost({ "design/design.md": "# d" });
  gh.failNextPatch = true; // first PATCH rejects as non-fast-forward
  const action = {
    v: 1, id: "01HZZ0000000000000000T003", type: "create_thread",
    actor: { id: "u", name: "U" }, ts: "2026-06-05T00:00:02.000Z",
    thread_id: "01HZZ0000000000000000T003", anchor: { quote: "z" }, body: "c",
  };
  const { attempts } = await commitAction(host, {
    branch: "main", docPath: "design/design.md", action,
  });
  assert.equal(attempts, 2, "retried once after the 422");
  const raw = await host.readFile("design/.gloss/design.md/_log/01HZZ0000000000000000T003.json", "main");
  assert.equal(JSON.parse(raw).body, "c");
});
