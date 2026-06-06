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
//
// Run offline: `node src/index.js --dev` uses an in-memory host seeded from the
// example repo, so the surface is exercisable without a token or network.

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MemoryHost, asReadHost } from "@gloss/git";
import { commitAction } from "@gloss/git";
import { readReviewFiles } from "@gloss/git";

const DEV = process.argv.includes("--dev");
const PORT = process.env.PORT || 8787;
const __dirname = dirname(fileURLToPath(import.meta.url));

// --- host wiring ----------------------------------------------------------
// In dev: one in-memory host seeded with the example doc. In prod: construct a
// GitHubHost per request from the reviewer's stored OAuth token (omitted here).
function devHost() {
  const host = new MemoryHost();
  const repoDir = join(__dirname, "../../../examples/repo");
  let md = "# Example design doc\n";
  try { md = readFileSync(join(repoDir, "design/design.md"), "utf-8"); } catch {}
  host.init("main", { "design/design.md": md });
  return host;
}
const host = DEV ? devHost() : null;
const DEV_USER = { id: "u_dev", name: "Dev User", email: "dev@example.com" };

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

    if (req.method === "GET" && url.pathname === "/tree") {
      const branch = q.get("branch") || "main";
      const files = await host.snapshot(branch);
      return json(res, 200, { branch, paths: Object.keys(files).filter((p) => !p.startsWith(".gloss/")) });
    }

    if (req.method === "GET" && url.pathname === "/file") {
      const branch = q.get("branch") || "main";
      const path = q.get("path");
      if (!path) return json(res, 400, { error: "path required" });
      const files = await host.snapshot(branch);
      if (!(path in files)) return json(res, 404, { error: "not found" });
      const commit = await host.getRef(branch); // the SHA the client stamps anchors against
      return json(res, 200, { path, branch, commit, content: files[path] });
    }

    if (req.method === "GET" && url.pathname === "/reviews") {
      const branch = q.get("branch") || "main";
      const path = q.get("path");
      if (!path) return json(res, 400, { error: "path required" });
      const { checkpoint, logTail } = await readReviewFiles(asReadHost(host, branch), path);
      return json(res, 200, { path, branch, checkpoint, logTail });
    }

    if (req.method === "POST" && url.pathname === "/reviews/actions") {
      const body = await readBody(req);
      const { branch = "main", path, action } = JSON.parse(body || "{}");
      if (!path || !action) return json(res, 400, { error: "path and action required" });
      // NOTE: a per-branch lock/queue belongs here so our own concurrent requests
      // don't all collide on the same head and burn host rate limit.
      const result = await commitAction(host, { branch, docPath: path, action });
      return json(res, 200, { ok: true, ...result });
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
