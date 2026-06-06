// apps/web/src/api.js
// Thin client over @gloss/server. The browser can't touch git directly, so all
// repo reads and the action commit go through the backend.

async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export const api = {
  repo: () => get(`/repo`),

  me: () => get(`/auth/me`),

  logout: () =>
    fetch(`/auth/logout`, { method: "POST" }).then((r) => r.json()),

  tree: (branch = "main") => get(`/tree?branch=${encodeURIComponent(branch)}`),

  file: (path, branch = "main") =>
    get(`/file?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`),

  reviews: (path, branch = "main") =>
    get(`/reviews?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`),

  postAction: async (path, action, branch = "main") => {
    const res = await fetch(`/reviews/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branch, path, action }),
    });
    if (!res.ok) throw new Error(`postAction → ${res.status}`);
    return res.json();
  },
};
