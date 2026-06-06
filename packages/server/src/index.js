// @gloss/server — src/index.js
//
// The thin backend. Its only jobs: authenticate the reviewer to the git host,
// read the file tree and content, and commit comment-actions to the branch. It
// never interprets a comment — the reducer and anchoring live client-side. That
// separation is what keeps the protocol portable and makes a future VS Code
// extension (talking to local git, no server) implement the same thing.
//
//   GET  /auth/login            → redirect to GitHub OAuth (or stub in dev)
//   GET  /auth/callback         → exchange code, store token server-side, set cookie
//   GET  /auth/me               → current reviewer (or null)
//   POST /auth/logout           → destroy the session
//   GET  /repo                  → which repo/branch the server is bound to
//   GET  /tree?branch           → file browser
//   GET  /file?path&branch      → markdown + its resolved commit SHA
//   GET  /reviews?path&branch   → latest checkpoint + log tail (client folds)
//   POST /reviews/actions       → commit one action (pull-rebase-push loop)
//   POST /reviews/compact       → fold log into a checkpoint, GC the old one
//
// Three modes:
//   --dev           in-memory host seeded from examples/repo; auth stubbed.
//   PAT             GITHUB_TOKEN + GLOSS_OWNER/REPO → one shared GitHubHost.
//   OAuth           GLOSS_OAUTH_CLIENT_ID/SECRET → each reviewer signs in with
//                   GitHub and commits as themselves (per-session GitHubHost).

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
import {
  createSessionStore,
  sidFromReq,
  setCookie,
  clearCookie,
} from "./session.js";

const DEV = process.argv.includes("--dev");
const PORT = process.env.PORT || 8787;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Where the browser reaches the app (the OAuth callback origin). The Vite proxy
// forwards /auth to this server, so this is the web origin in dev.
const BASE_URL = process.env.GLOSS_BASE_URL || "http://localhost:5173";
const OAUTH = {
  clientId: process.env.GLOSS_OAUTH_CLIENT_ID,
  clientSecret: process.env.GLOSS_OAUTH_CLIENT_SECRET,
  scope: process.env.GLOSS_OAUTH_SCOPE || "repo",
  redirectUri: `${BASE_URL}/auth/callback`,
};
// Mode: dev > oauth (client id+secret) > pat (token). Chosen once at boot.
const MODE = DEV ? "dev" : OAUTH.clientId && OAUTH.clientSecret ? "oauth" : "pat";

// --- host wiring ----------------------------------------------------------
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

// One shared GitHubHost from a Personal Access Token (single-user PAT mode).
function patHost() {
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
        `Set them (or GLOSS_OAUTH_CLIENT_ID/SECRET for multi-user, or run --dev).`,
    );
  }
  console.log(`patHost: GitHubHost → ${owner}/${repo}`);
  return new GitHubHost({ owner, repo, token });
}

// OAuth mode still needs to know the repo/owner; tokens come per-session.
function requireRepoEnv() {
  const owner = process.env.GLOSS_OWNER;
  const repo = process.env.GLOSS_REPO;
  if (!owner || !repo) {
    throw new Error("@gloss/server: OAuth mode needs GLOSS_OWNER and GLOSS_REPO.");
  }
  return { owner, repo };
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

const sessions = createSessionStore();
const SECURE_COOKIE = BASE_URL.startsWith("https://");

// In dev/pat the host is a fixed singleton. In oauth it's built per request from
// the reviewer's session token.
const sharedHost = MODE === "dev" ? devHost() : MODE === "pat" ? patHost() : null;
if (MODE === "oauth") requireRepoEnv();

const DEV_USER = { id: "u_dev", name: "Dev User", login: "dev" };
const PAT_USER = { id: "u_pat", name: process.env.GLOSS_OWNER || "Owner", login: process.env.GLOSS_OWNER || "owner" };

// Resolve the HostAdapter for a request. Returns { host } or { needsLogin:true }.
function resolveHost(req) {
  if (MODE !== "oauth") return { host: sharedHost };
  const s = sessions.get(sidFromReq(req));
  if (!s) return { needsLogin: true };
  const { owner, repo } = requireRepoEnv();
  return { host: new GitHubHost({ owner, repo, token: s.token }), user: s.user };
}

// The reviewer identity for a request, or null. Drives /auth/me and is what the
// web app stamps as the action actor.
function userFor(req) {
  if (MODE === "dev") return DEV_USER;
  if (MODE === "pat") return PAT_USER;
  const s = sessions.get(sidFromReq(req));
  return s ? s.user : null;
}

// Identity of the repo this server is bound to — surfaced to the web app.
const REPO_INFO = MODE === "dev"
  ? { owner: null, repo: "examples/repo", slug: "examples/repo", branch: "main", mode: "dev", auth: "dev" }
  : {
      owner: process.env.GLOSS_OWNER,
      repo: process.env.GLOSS_REPO,
      slug: `${process.env.GLOSS_OWNER}/${process.env.GLOSS_REPO}`,
      branch: process.env.GLOSS_BRANCH || "main",
      mode: "github",
      auth: MODE, // "oauth" | "pat"
    };

// Serialize writes per branch so our own concurrent commits don't all read the
// same head, collide on updateRef, and thrash the rebase-retry loop.
const writes = createBranchQueue();

// One read-path shape for both backends: MemoryHost via the standalone
// asReadHost(host, branch); GitHubHost via its own asReadHost(branch) method.
function readHostFor(host, branch) {
  return typeof host.asReadHost === "function"
    ? host.asReadHost(branch)
    : asReadHost(host, branch);
}

// --- tiny router -----------------------------------------------------------
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
};

const redirect = (res, location, setCookieValue) => {
  const headers = { location };
  if (setCookieValue) headers["set-cookie"] = setCookieValue;
  res.writeHead(302, headers);
  res.end();
};

// Exchange an OAuth code for an access token, then fetch the GitHub identity.
async function exchangeCodeForUser(code) {
  const tokRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: OAUTH.clientId,
      client_secret: OAUTH.clientSecret,
      code,
      redirect_uri: OAUTH.redirectUri,
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) {
    throw new Error(`token exchange failed: ${tok.error_description || tok.error || "no token"}`);
  }
  const meRes = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${tok.access_token}`,
      accept: "application/vnd.github+json",
      "user-agent": "gloss",
    },
  });
  if (!meRes.ok) throw new Error(`/user failed: ${meRes.status}`);
  const gh = await meRes.json();
  const user = {
    id: `gh_${gh.id}`,
    login: gh.login,
    name: gh.name || gh.login,
    avatar_url: gh.avatar_url,
  };
  return { token: tok.access_token, user };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const q = url.searchParams;
  try {
    // --- auth -------------------------------------------------------------
    if (req.method === "GET" && url.pathname === "/auth/login") {
      if (MODE !== "oauth") {
        // dev/pat: no real login; report the synthetic identity.
        return json(res, 200, { user: userFor(req), note: `${MODE} mode: auth stubbed` });
      }
      const state = sessions.newState(q.get("redirect") || BASE_URL);
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", OAUTH.clientId);
      authorize.searchParams.set("redirect_uri", OAUTH.redirectUri);
      authorize.searchParams.set("scope", OAUTH.scope);
      authorize.searchParams.set("state", state);
      return redirect(res, authorize.toString());
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      if (MODE !== "oauth") return json(res, 200, { ok: true, user: userFor(req) });
      const code = q.get("code");
      const state = q.get("state");
      const dest = sessions.consumeState(state);
      if (!code || !dest) return json(res, 400, { error: "bad or expired OAuth state" });
      const { token, user } = await exchangeCodeForUser(code);
      const sid = sessions.create(token, user);
      return redirect(res, dest, setCookie(sid, { secure: SECURE_COOKIE }));
    }

    if (req.method === "GET" && url.pathname === "/auth/me") {
      return json(res, 200, { user: userFor(req), mode: MODE });
    }

    if (req.method === "POST" && url.pathname === "/auth/logout") {
      sessions.destroy(sidFromReq(req));
      res.writeHead(200, { "content-type": "application/json", "set-cookie": clearCookie() });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === "GET" && url.pathname === "/repo") {
      // Tells the web app which repo/branch it's actually pointed at.
      return json(res, 200, REPO_INFO);
    }

    // --- everything below needs a host; in oauth mode that means a session --
    const resolved = resolveHost(req);
    if (resolved.needsLogin) return json(res, 401, { error: "login required", login: "/auth/login" });
    const host = resolved.host;

    if (req.method === "GET" && url.pathname === "/tree") {
      const branch = q.get("branch") || "main";
      const treePaths = (await host.listPaths(branch)).filter(
        // Only surface doc-like files; any path with a `.gloss/` segment is
        // review metadata and lives behind /reviews instead.
        (p) => p.endsWith(".md") && !p.split("/").includes(".gloss"),
      );
      return json(res, 200, { branch, paths: treePaths });
    }

    if (req.method === "GET" && url.pathname === "/file") {
      const branch = q.get("branch") || "main";
      const path = q.get("path");
      if (!path) return json(res, 400, { error: "path required" });
      const content = await readHostFor(host, branch).readFile(path);
      if (content == null) return json(res, 404, { error: "not found" });
      const commit = await host.getRef(branch); // the SHA the client stamps anchors against
      return json(res, 200, { path, branch, commit, content });
    }

    if (req.method === "GET" && url.pathname === "/reviews") {
      const branch = q.get("branch") || "main";
      const path = q.get("path");
      if (!path) return json(res, 400, { error: "path required" });
      const { checkpoint, logTail } = await readReviewFiles(readHostFor(host, branch), path);
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
        const read = readHostFor(host, branch);
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
  console.log(`@gloss/server listening on http://localhost:${PORT} (mode: ${MODE})`);
});

export { server };
