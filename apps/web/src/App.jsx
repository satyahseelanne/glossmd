// apps/web/src/App.jsx
//
// The reviewer surface. Owns the global state and is the one place that builds
// and posts actions; each leaf component is presentational.
//
// State is derived: `reduced` is what @gloss/core's load() returns given the
// latest checkpoint and the log tail the backend hands us. Every UI commit
// (create/reply/edit/delete/resolve/reopen) builds an action with the core
// builders, POSTs it through the generic api.postAction, then re-fetches and
// re-reduces. We never mutate locally — the reducer is the only source of truth.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ulid,
  load,
  createThread,
  addComment,
  editComment,
  deleteComment,
  resolveThread,
  reopenThread,
} from "@gloss/core";
import { api } from "./api.js";
import TopBar from "./components/TopBar.jsx";
import Tree from "./components/Tree.jsx";
import DocumentPane from "./components/DocumentPane.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Toast from "./components/Toast.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import SignIn from "./components/SignIn.jsx";
const DEFAULT_BRANCH = "main";

export default function App() {
  const [me, setMe] = useState(null);                // logged-in reviewer
  const [authMode, setAuthMode] = useState(null);    // "dev" | "pat" | "oauth"
  const [authReady, setAuthReady] = useState(false);
  const [repoInfo, setRepoInfo] = useState({ slug: "…", branch: DEFAULT_BRANCH });

  // --- selection: which repo + branch we're reviewing ---
  const [repos, setRepos] = useState([]);            // [{ owner, repo, slug, default_branch }]
  const [selRepo, setSelRepo] = useState(null);      // { owner, repo, slug }
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState(DEFAULT_BRANCH);

  const [tree, setTree] = useState([]);
  const [docPath, setDocPath] = useState(null);
  const [file, setFile] = useState(null);            // { content, commit }
  const [reduced, setReduced] = useState(null);      // full review state
  const [threadCounts, setThreadCounts] = useState({}); // path → open thread count
  const [activeThread, setActiveThread] = useState(null);
  const [focus, setFocus] = useState(null);          // { pane, id, n } scroll signal
  const [draft, setDraft] = useState(null);          // { anchor } for the composer
  const [filter, setFilter] = useState("all");
  const [orphanIds, setOrphanIds] = useState([]);    // threads the renderer couldn't locate
  const [toast, setToast] = useState(null);
  const [editRequest, setEditRequest] = useState(0); // nonce: ask the doc pane to open in Edit mode

  // The { owner, repo, branch } context passed to every api call.
  const ctx = useMemo(
    () => ({ owner: selRepo?.owner ?? undefined, repo: selRepo?.repo ?? undefined, branch }),
    [selRepo, branch],
  );

  // --- bootstrap: who am I? then default repo identity + the repo list ---
  useEffect(() => {
    api.repo().then((info) => {
      setRepoInfo(info);
      setBranch(info.branch || DEFAULT_BRANCH);
    }).catch(console.error);
    api.me().then((r) => {
      setMe(r.user ?? null);
      setAuthMode(r.mode ?? null);
      setAuthReady(true);
    }).catch(() => setAuthReady(true));
  }, []);

  // Once authenticated, load the repos the reviewer can write to and pick one.
  useEffect(() => {
    if (!authReady || !me) return;
    api.repos().then(({ repos }) => {
      setRepos(repos);
      // Default to the server's configured repo if present, else the first.
      const fromInfo = repos.find((r) => r.slug === repoInfo.slug);
      setSelRepo(fromInfo ?? repos[0] ?? null);
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, me]);

  // When the selected repo changes, load its branches and default the branch.
  useEffect(() => {
    if (!selRepo) return;
    api.branches({ owner: selRepo.owner, repo: selRepo.repo }).then(({ branches }) => {
      setBranches(branches);
      // Keep current branch if it exists on this repo, else the repo's default.
      setBranch((b) => (branches.includes(b) ? b : selRepo.default_branch || branches[0] || DEFAULT_BRANCH));
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRepo]);

  // Load the file tree whenever the repo or branch changes.
  useEffect(() => {
    if (!authReady || !me || !selRepo) return;
    setDocPath(null);
    setFile(null);
    setReduced(null);
    api.tree(ctx).then((t) => {
      const mds = (t.paths ?? []).filter((p) => p.endsWith(".md"));
      setTree(mds);
      setDocPath(mds.find((p) => /design\.md$/.test(p)) ?? mds[0] ?? null);
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, me, selRepo, branch]);

  // --- load the selected doc + its reviews whenever the path changes ---
  const loadDoc = useCallback(async (path) => {
    if (!path) return;
    const [f, r] = await Promise.all([api.file(path, ctx), api.reviews(path, ctx)]);
    setFile(f);
    setReduced(load(r.checkpoint, r.logTail));
    setActiveThread(null);
    setDraft(null);
  }, [ctx]);

  useEffect(() => {
    loadDoc(docPath).catch(console.error);
  }, [docPath, loadDoc]);

  // --- background pass: count open threads per doc for the tree badges ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const counts = {};
      for (const p of tree) {
        try {
          const r = await api.reviews(p, ctx);
          const state = load(r.checkpoint, r.logTail);
          counts[p] = Object.values(state.threads).filter((t) => t.status === "open").length;
        } catch {
          counts[p] = 0;
        }
        if (cancelled) return;
      }
      if (!cancelled) setThreadCounts(counts);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, reduced]); // re-count after any commit

  // Live thread list — sorted by creation stamp for stable pin numbering.
  const threads = useMemo(() => {
    if (!reduced) return [];
    return Object.values(reduced.threads).sort((a, b) => {
      const sa = a.created_by ?? { ts: a.thread_id, id: a.thread_id };
      const sb = b.created_by ?? { ts: b.thread_id, id: b.thread_id };
      if (sa.ts < sb.ts) return -1;
      if (sa.ts > sb.ts) return 1;
      return sa.id < sb.id ? -1 : sa.id > sb.id ? 1 : 0;
    });
  }, [reduced]);

  const knownActors = useMemo(() => {
    if (!reduced) return [];
    const m = new Map();
    for (const t of Object.values(reduced.threads)) {
      for (const c of t.comments) {
        if (c.actor?.id) m.set(c.actor.id, c.actor);
      }
    }
    return Array.from(m.values());
  }, [reduced]);

  // --- one post-and-refresh helper for every action type ---
  async function postAction(action, label) {
    try {
      const res = await api.postAction(docPath, action, ctx);
      setToast({ message: label, action: action.type, id: action.id });
      // re-load this doc; the tree-count effect re-runs because `reduced` changes.
      await loadDoc(docPath);
      return res;
    } catch (err) {
      setToast({ message: `Failed: ${err.message}`, action: action.type, id: action.id });
    }
  }

  const now = () => new Date().toISOString();

  function postCreateThread(body) {
    if (!draft || !body.trim()) return;
    const action = createThread({
      id: ulid(), actor: me, ts: now(),
      anchor: draft.anchor, body: body.trim(),
    });
    setDraft(null);
    setActiveThread(action.thread_id);
    return postAction(action, "Thread created");
  }
  function postReply(threadId, body) {
    return postAction(
      addComment({ id: ulid(), actor: me, ts: now(), thread_id: threadId, body }),
      "Reply committed",
    );
  }
  function postEdit(commentId, body) {
    return postAction(
      editComment({ id: ulid(), actor: me, ts: now(), target: commentId, body }),
      "Comment edited",
    );
  }
  function postDelete(commentId) {
    return postAction(
      deleteComment({ id: ulid(), actor: me, ts: now(), target: commentId }),
      "Comment deleted",
    );
  }
  function postResolve(threadId) {
    return postAction(
      resolveThread({ id: ulid(), actor: me, ts: now(), thread_id: threadId }),
      "Thread resolved",
    );
  }
  function postReopen(threadId) {
    return postAction(
      reopenThread({ id: ulid(), actor: me, ts: now(), thread_id: threadId }),
      "Thread reopened",
    );
  }

  // --- wire the doc pane ---
  const startThread = useCallback((anchor) => {
    setDraft({ anchor });
    setFilter("all");
  }, []);

  // Edit mode: commit the markdown itself to the branch, then reload the doc so
  // anchors re-locate against the new text (orphans fall out naturally). Rethrows
  // on failure so the doc pane stays in edit mode with the user's buffer intact.
  const saveDoc = useCallback(async (content) => {
    if (!docPath) return;
    try {
      const res = await api.saveFile(docPath, content, ctx);
      setToast({ message: "Document saved", action: "edit_doc", id: res.commitSha ?? docPath });
      await loadDoc(docPath);
    } catch (err) {
      setToast({ message: `Save failed: ${err.message}`, action: "edit_doc", id: docPath });
      throw err;
    }
  }, [docPath, ctx, loadDoc]);

  // Create a new document. A path like "design/api/spec.md" creates the folders
  // implicitly (git has no empty dirs). Commits a starter heading, refreshes the
  // tree, selects the new doc, and signals the doc pane to open straight in Edit.
  const createDoc = useCallback(async (rawPath) => {
    const path = normalizeDocPath(rawPath);
    if (!path) return;
    if (tree.includes(path)) {
      setToast({ message: "That document already exists", action: "create_doc", id: path });
      setDocPath(path);
      return;
    }
    const title = path.split("/").pop().replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
    const content = `# ${title || "Untitled"}\n\n`;
    try {
      await api.saveFile(path, content, ctx);
      const t = await api.tree(ctx);
      setTree((t.paths ?? []).filter((p) => p.endsWith(".md")));
      setDocPath(path);
      await loadDoc(path);
      setEditRequest((n) => n + 1); // open the fresh doc in Edit mode
      setToast({ message: "Document created", action: "create_doc", id: path });
    } catch (err) {
      setToast({ message: `Create failed: ${err.message}`, action: "create_doc", id: path });
    }
  }, [ctx, tree, loadDoc]);

  // Delete a document (with its co-located .gloss review data) or a folder (all
  // docs beneath it). Refreshes the tree; if the open doc was removed, clears it.
  const deleteDoc = useCallback(async (path, type = "doc") => {
    try {
      await api.deleteFile(path, type, ctx);
      const t = await api.tree(ctx);
      const mds = (t.paths ?? []).filter((p) => p.endsWith(".md"));
      setTree(mds);
      // Was the currently-open doc removed?
      const removed = type === "folder" ? docPath?.startsWith(path.replace(/\/$/, "") + "/") : docPath === path;
      if (removed) {
        const next = mds[0] ?? null;
        setDocPath(next);
        if (!next) { setFile(null); setReduced(null); }
      }
      setToast({ message: type === "folder" ? "Folder deleted" : "Document deleted", action: "delete_doc", id: path });
    } catch (err) {
      setToast({ message: `Delete failed: ${err.message}`, action: "delete_doc", id: path });
    }
  }, [ctx, docPath]);

  // Selecting a thread activates it AND asks the *other* pane to scroll it into
  // view: click an inline anchor → the sidebar card scrolls; click a card → the
  // document anchor scrolls. The `n` nonce makes repeat clicks re-fire the effect.
  const selectFromDoc = useCallback((id) => {
    setActiveThread(id);
    setFocus({ pane: "sidebar", id, n: Date.now() });
  }, []);
  const selectFromSidebar = useCallback((id) => {
    setActiveThread(id);
    setFocus({ pane: "doc", id, n: Date.now() });
  }, []);

  // Sign-in gate: in OAuth mode, block the app until the reviewer authenticates.
  if (authReady && authMode === "oauth" && !me) {
    return <SignIn />;
  }

  return (
    <div className="app">
      <TopBar
        repos={repos}
        selRepo={selRepo}
        onSelectRepo={(slug) => {
          const r = repos.find((x) => x.slug === slug);
          if (r) setSelRepo(r);
        }}
        branches={branches}
        branch={branch}
        onSelectBranch={setBranch}
        me={me}
        authMode={authMode}
        knownActors={knownActors}
      />

      <ErrorBoundary label="file tree">
        <Tree
          paths={tree}
          branch={branch}
          activePath={docPath}
          threadCounts={threadCounts}
          onSelect={(p) => setDocPath(p)}
          onNewDoc={me ? createDoc : null}
          onDelete={me ? deleteDoc : null}
        />
      </ErrorBoundary>

      <ErrorBoundary label="document">
        <DocumentPane
          docPath={docPath}
          file={file}
          threads={threads}
          activeThread={activeThread}
          focus={focus}
          canEdit={!!me}
          editRequest={editRequest}
          onSelectThread={selectFromDoc}
          onStartThread={startThread}
          onSaveDoc={saveDoc}
          onOrphans={setOrphanIds}
        />
      </ErrorBoundary>

      <Sidebar
        threads={threads}
        orphanIds={orphanIds}
        draft={draft}
        filter={filter}
        activeThread={activeThread}
        focus={focus}
        me={me}
        onFilterChange={setFilter}
        onActivate={selectFromSidebar}
        onStartReply={postReply}
        onEdit={postEdit}
        onDelete={postDelete}
        onResolve={postResolve}
        onReopen={postReopen}
        onCancelDraft={() => setDraft(null)}
        onSubmitDraft={postCreateThread}
      />

      <Toast toast={toast} onClear={() => setToast(null)} />
    </div>
  );
}

// Normalize a user-typed document path: trim, drop a leading slash, collapse
// repeated slashes, and ensure a .md extension. Returns "" if there's nothing
// usable (so callers can bail). Folders in the path are created implicitly on
// commit — git has no standalone directories.
function normalizeDocPath(raw) {
  if (!raw) return "";
  let p = String(raw).trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!p || p.endsWith("/")) return "";
  if (!/\.md$/i.test(p)) p += ".md";
  return p;
}

