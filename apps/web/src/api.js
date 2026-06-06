// apps/web/src/api.js
// Thin client over @gloss/server. The browser can't touch git directly, so all
// repo reads and the action commit go through the backend. Most calls carry an
// optional { owner, repo, branch } context so the user can switch repo/branch;
// the server defaults to its configured repo when they're omitted.

async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// Build a query string from a context object, dropping empty values.
function qs(ctx = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(ctx)) if (v != null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  repo: () => get(`/repo`),
  repos: () => get(`/repos`),

  me: () => get(`/auth/me`),
  logout: () => fetch(`/auth/logout`, { method: "POST" }).then((r) => r.json()),

  branches: ({ owner, repo } = {}) => get(`/branches${qs({ owner, repo })}`),

  tree: ({ owner, repo, branch = "main" } = {}) => get(`/tree${qs({ owner, repo, branch })}`),

  file: (path, { owner, repo, branch = "main" } = {}) =>
    get(`/file${qs({ owner, repo, branch, path })}`),

  // Commit an edit to the document content itself (returns the new commit SHA).
  saveFile: async (path, content, { owner, repo, branch = "main" } = {}) => {
    const res = await fetch(`/file${qs({ owner, repo })}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch, path, content }),
    });
    if (!res.ok) throw new Error(`saveFile → ${res.status}`);
    return res.json();
  },

  // Delete a document (with its .gloss review data) or a folder (everything
  // under it). `type` is "doc" or "folder".
  deleteFile: async (path, type, { owner, repo, branch = "main" } = {}) => {
    const res = await fetch(`/file/delete${qs({ owner, repo })}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch, path, type }),
    });
    if (!res.ok) throw new Error(`deleteFile → ${res.status}`);
    return res.json();
  },

  reviews: (path, { owner, repo, branch = "main" } = {}) =>
    get(`/reviews${qs({ owner, repo, branch, path })}`),

  postAction: async (path, action, { owner, repo, branch = "main" } = {}) => {
    const res = await fetch(`/reviews/actions${qs({ owner, repo })}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch, path, action }),
    });
    if (!res.ok) throw new Error(`postAction → ${res.status}`);
    return res.json();
  },
};
