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

const BRANCH = "main";

export default function App() {
  const [me, setMe] = useState(null);                // logged-in reviewer
  const [authMode, setAuthMode] = useState(null);    // "dev" | "pat" | "oauth"
  const [authReady, setAuthReady] = useState(false);
  const [repoInfo, setRepoInfo] = useState({ slug: "…", branch: BRANCH });
  const [tree, setTree] = useState([]);
  const [docPath, setDocPath] = useState(null);
  const [file, setFile] = useState(null);            // { content, commit }
  const [reduced, setReduced] = useState(null);      // full review state
  const [threadCounts, setThreadCounts] = useState({}); // path → open thread count
  const [activeThread, setActiveThread] = useState(null);
  const [draft, setDraft] = useState(null);          // { anchor } for the composer
  const [filter, setFilter] = useState("all");
  const [orphanIds, setOrphanIds] = useState([]);    // threads the renderer couldn't locate
  const [toast, setToast] = useState(null);

  // --- bootstrap: who am I? then repo identity + tree (once authenticated) ---
  useEffect(() => {
    api.repo().then(setRepoInfo).catch(console.error);
    api.me().then((r) => {
      setMe(r.user ?? null);
      setAuthMode(r.mode ?? null);
      setAuthReady(true);
    }).catch(() => setAuthReady(true));
  }, []);

  // Load the tree only once we have a reviewer (oauth) or are in dev/pat.
  useEffect(() => {
    if (!authReady || !me) return;
    api.tree(BRANCH).then((t) => {
      const mds = (t.paths ?? []).filter((p) => p.endsWith(".md"));
      setTree(mds);
      if (mds.length && !docPath) setDocPath(mds.find((p) => /design\.md$/.test(p)) ?? mds[0]);
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, me]);

  // --- load the selected doc + its reviews whenever the path changes ---
  const loadDoc = useCallback(async (path) => {
    if (!path) return;
    const [f, r] = await Promise.all([api.file(path, BRANCH), api.reviews(path, BRANCH)]);
    setFile(f);
    setReduced(load(r.checkpoint, r.logTail));
    setActiveThread(null);
    setDraft(null);
  }, []);

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
          const r = await api.reviews(p, BRANCH);
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
      const res = await api.postAction(docPath, action, BRANCH);
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

  // Sign-in gate: in OAuth mode, block the app until the reviewer authenticates.
  if (authReady && authMode === "oauth" && !me) {
    return <SignIn repo={repoInfo.slug} />;
  }

  return (
    <div className="app">
      <TopBar branch={repoInfo.branch ?? BRANCH} repo={repoInfo.slug} me={me} authMode={authMode} knownActors={knownActors} />

      <ErrorBoundary label="file tree">
        <Tree
          paths={tree}
          branch={BRANCH}
          activePath={docPath}
          threadCounts={threadCounts}
          onSelect={(p) => setDocPath(p)}
        />
      </ErrorBoundary>

      <ErrorBoundary label="document">
        <DocumentPane
          docPath={docPath}
          file={file}
          threads={threads}
          activeThread={activeThread}
          onSelectThread={setActiveThread}
          onStartThread={startThread}
          onOrphans={setOrphanIds}
        />
      </ErrorBoundary>

      <Sidebar
        threads={threads}
        orphanIds={orphanIds}
        draft={draft}
        filter={filter}
        activeThread={activeThread}
        me={me}
        onFilterChange={setFilter}
        onActivate={setActiveThread}
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

