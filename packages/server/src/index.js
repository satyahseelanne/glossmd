// @gloss/server — src/index.js
//
// The thin backend. Its only jobs: authenticate the reviewer to the git host,
// read the file tree and content, and commit comment-actions to the branch. It
// never interprets a comment — the reducer and anchoring live client-side. That
// separation is what keeps the protocol portable and makes a future VS Code
// extension (talking to local git, no server) implement the same thing.
//
//   GET  /auth/login            → redirect to the host's OAuth
//   GET  /auth/callback         → exchange code, store token server-side
//   GET  /tree?branch           → file browser
//   GET  /file?path&branch      → markdown + its resolved commit SHA
//   GET  /reviews?path&branch   → latest checkpoint + log tail (client folds)
//   POST /reviews/actions       → commit one action (pull-rebase-push loop)
//   POST /reviews/compact       → fold log into a checkpoint, GC the old one
//
// Run offline: `node src/index.js --dev` uses an in-memory host seeded from the
// example repo, so the surface is exercisable without a token or network.

import http from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { MemoryHost, GitHubHost, asReadHost } from "@gloss/git";
import { commitAction, commitCheckpoint } from "@gloss/git";
import { readReviewFiles } from "@gloss/git";
import { paths } from "@gloss/git";
import { ulid, compact } from "@gloss/core";
import { createBranchQueue } from "./queue.js";

const DEV = process.argv.includes("--dev");
const PORT = process.env.PORT || 8787;
const __dirname = dirname(fileURLToPath(import.meta.url));

// --- host wiring ----------------------------------------------------------
// In dev: one in-memory host seeded with the example repo, walked recursively
// so the file tree is meaningful and any pre-existing .gloss/ log is loaded
// alongside the docs. In prod: a single GitHubHost built from a Personal Access
// Token + owner/repo in the environment (Phase 2's single-user mode; the OAuth
// flow that mints a per-reviewer token slots in here later).
function devHost() {
  const host = new MemoryHost();
  const repoDir = join(__dirname, "../../../examples/repo");
  const files = {};
  try {
    for (const abs of walk(repoDir)) {
      const rel = relative(repoDir, abs).split(sep).join("/");
      files[rel] = readFileSync(abs, "utf-8");
    }
  } catch (err) {
    console.warn("devHost: could not read examples/repo —", err.message);
  }
  if (Object.keys(files).length === 0) files["design/design.md"] = "# Example design doc\n";
  host.init("main", files);
  console.log(`devHost: seeded ${Object.keys(files).length} files from examples/repo`);
  return host;
}

// Build a live GitHubHost from the environment. Throws (loudly, at boot) if the
// required configuration is missing — better than 500ing on the first request.
function prodHost() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GLOSS_OWNER;
  const repo = process.env.GLOSS_REPO;
  const missing = [
    !token && "GITHUB_TOKEN",
    !owner && "GLOSS_OWNER",
    !repo && "GLOSS_REPO",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `@gloss/server: missing env ${missing.join(", ")}. ` +
        `Set them (or run with --dev) — e.g. GITHUB_TOKEN=ghp_… GLOSS_OWNER=acme GLOSS_REPO=docs.`,
    );
  }
  console.log(`prodHost: GitHubHost → ${owner}/${repo}`);
  return new GitHubHost({ owner, repo, token });
}

// Recursively yield every file path under root (skip nothing — .gloss/ included).
function* walk(root) {
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile()) yield full;
  }
}
const host = DEV ? devHost() : prodHost();
const DEV_USER = { id: "u_dev", name: "Dev User", email: "dev@example.com" };

// Identity of the repo this server is bound to — surfaced to the web app so the
// topbar shows the real repo/branch instead of a placeholder. In dev there is no
// remote, so we label it accordingly.
const REPO_INFO = DEV
  ? { owner: null, repo: "examples/repo", slug: "examples/repo", branch: "main", mode: "dev" }
  : {
      owner: process.env.GLOSS_OWNER,
      repo: process.env.GLOSS_REPO,
      slug: `${process.env.GLOSS_OWNER}/${process.env.GLOSS_REPO}`,
      branch: process.env.GLOSS_BRANCH || "main",
      mode: "github",
    };

// Serialize writes per branch so our own concurrent commits don't all read the
// same head, collide on updateRef, and thrash the rebase-retry loop.
const writes = createBranchQueue();

// One read-path shape for both backends: MemoryHost via the standalone
// asReadHost(host, branch); GitHubHost via its own asReadHost(branch) method.
function readHostFor(branch) {
  return typeof host.asReadHost === "function"
    ? host.asReadHost(branch)
    : asReadHost(host, branch);
}

// --- tiny router -----------------------------------------------------------
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const q = url.searchParams;
  try {
    if (req.method === "GET" && url.pathname === "/auth/login") {
      if (DEV) return json(res, 200, { user: DEV_USER, note: "dev mode: auth stubbed" });
      // prod: 302 → https://github.com/login/oauth/authorize?...client_id...&scope=repo
      return json(res, 501, { error: "OAuth not configured" });
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      // prod: exchange ?code for a token, store server-side, set a session cookie
      return json(res, DEV ? 200 : 501, DEV ? { ok: true, user: DEV_USER } : { error: "OAuth not configured" });
    }

    if (req.method === "GET" && url.pathname === "/repo") {
      // Tells the web app which repo/branch it's actually pointed at.
      return json(res, 200, REPO_INFO);
    }

    if (req.method === "GET" && url.pathname === "/tree") {
      const branch = q.get("branch") || "main";
      const paths = (await host.listPaths(branch)).filter(
        // Only surface doc-like files; any path with a `.gloss/` segment is
        // review metadata and lives behind /reviews instead.
        (p) => p.endsWith(".md") && !p.split("/").includes(".gloss"),
      );
      return json(res, 200, { branch, paths });
    }

    if (req.method === "GET" && url.pathname === "/file") {
      const branch = q.get("branch") || "main";
      const path = q.get("path");
      if (!path) return json(res, 400, { error: "path required" });
      const content = await readHostFor(branch).readFile(path);
      if (content == null) return json(res, 404, { error: "not found" });
      const commit = await host.getRef(branch); // the SHA the client stamps anchors against
      return json(res, 200, { path, branch, commit, content });
    }

    if (req.method === "GET" && url.pathname === "/reviews") {
      const branch = q.get("branch") || "main";
      const path = q.get("path");
      if (!path) return json(res, 400, { error: "path required" });
      const { checkpoint, logTail } = await readReviewFiles(readHostFor(branch), path);
      return json(res, 200, { path, branch, checkpoint, logTail });
    }

    if (req.method === "POST" && url.pathname === "/reviews/actions") {
      const body = await readBody(req);
      const { branch = "main", path, action } = JSON.parse(body || "{}");
      if (!path || !action) return json(res, 400, { error: "path and action required" });
      // Per-branch queue: each write sees the previous one's new head, so the
      // commit loop's optimistic CAS lands in one attempt in the common case.
      const result = await writes.run(branch, () =>
        commitAction(host, { branch, docPath: path, action }),
      );
      return json(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && url.pathname === "/reviews/compact") {
      const body = await readBody(req);
      const { branch = "main", path } = JSON.parse(body || "{}");
      if (!path) return json(res, 400, { error: "path required" });
      // Fold the un-folded log into a fresh checkpoint and delete the folded
      // action files (and the superseded checkpoint) in one atomic commit.
      // Runs on the per-branch queue so it serializes with comment writes.
      const out = await writes.run(branch, async () => {
        const read = readHostFor(branch);
        const { checkpoint: prior, logTail } = await readReviewFiles(read, path);
        if (logTail.length === 0) return { compacted: 0, note: "nothing to compact" };
        const { checkpoint, folded } = compact(ulid, new Date().toISOString(), logTail, prior);
        const foldedLogPaths = folded.map((a) => paths.logPath(path, a.id));
        // GC: delete the checkpoint this one supersedes, atomically.
        const removePaths = prior ? [paths.checkpointPath(path, prior.id)] : [];
        const commit = await commitCheckpoint(host, {
          branch, docPath: path, checkpoint, foldedLogPaths, removePaths,
        });
        return { compacted: folded.length, checkpointId: checkpoint.id, superseded: prior?.id ?? null, ...commit };
      });
      return json(res, 200, { ok: true, ...out });
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      return res.end();
    }

    return json(res, 404, { error: "no route" });
  } catch (err) {
    return json(res, 500, { error: String(err.message || err) });
  }
});

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

server.listen(PORT, () => {
  console.log(`@gloss/server listening on http://localhost:${PORT} ${DEV ? "(dev: in-memory host)" : ""}`);
});

export { server };
