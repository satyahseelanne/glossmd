// apps/web/src/App.jsx
//
// The reviewer surface, wired to the real protocol. This is a working skeleton —
// it loads a file and its reviews from the backend, renders the markdown, lets
// you select text to create a thread, and commits that thread as an action. The
// mockup (docs/) shows the fully-styled target; this proves the data path.
//
// Note the division of labour: @gloss/core reduces the log into threads,
// @gloss/anchor turns a selection into a stored selector and re-locates it on
// load. The component just renders the result and posts actions.

import React, { useEffect, useMemo, useState, useRef } from "react";
import { marked } from "marked";
import { ulid, load, createThread, addComment } from "@gloss/core";
import { captureSelection, resolveAnchor } from "@gloss/anchor";
import { api } from "./api.js";

const ME = { id: "u_dev", name: "You" };
const DOC = "design/design.md";
const BRANCH = "main";

export default function App() {
  const [file, setFile] = useState(null);     // { content, commit }
  const [state, setState] = useState(null);    // reduced review state
  const [draft, setDraft] = useState(null);     // { anchor } pending composer
  const [active, setActive] = useState(null);
  const docRef = useRef(null);

  async function refresh() {
    const f = await api.file(DOC, BRANCH);
    const r = await api.reviews(DOC, BRANCH);
    setFile(f);
    setState(load(r.checkpoint, r.logTail)); // client folds the log — same code as everywhere
  }
  useEffect(() => { refresh().catch(console.error); }, []);

  const html = useMemo(() => (file ? marked.parse(file.content) : ""), [file]);
  const threads = state ? Object.values(state.threads) : [];

  // After render, re-locate each thread's anchor in the rendered text and note
  // which orphaned (couldn't be found).
  const rendered = docRef.current?.textContent ?? "";
  const located = threads.map((t) => ({
    thread: t,
    ...resolveAnchor(rendered, {
      quote: t.anchor.quote,
      prefix: t.anchor.prefix,
      suffix: t.anchor.suffix,
      textPosition: t.anchor.text_position,
    }),
  }));

  function onMouseUp() {
    if (!file || !docRef.current) return;
    const anchor = captureSelection(docRef.current, file.commit, DOC);
    if (anchor) setDraft({ anchor });
  }

  async function postThread(body) {
    const action = createThread({
      id: ulid(), actor: ME, ts: new Date().toISOString(),
      anchor: draft.anchor, body,
    });
    await api.postAction(DOC, action, BRANCH);
    setDraft(null);
    await refresh();
  }

  async function postReply(thread_id, body) {
    const action = addComment({ id: ulid(), actor: ME, ts: new Date().toISOString(), thread_id, body });
    await api.postAction(DOC, action, BRANCH);
    await refresh();
  }

  return (
    <div style={S.app}>
      <header style={S.top}>¶ Gloss · <code>{DOC}</code> @ <code>{file?.commit?.slice(0, 7) ?? "…"}</code></header>
      <div style={S.body}>
        <main style={S.docPane}>
          <article
            ref={docRef}
            onMouseUp={onMouseUp}
            style={S.doc}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </main>
        <aside style={S.side}>
          <h3 style={{ margin: "0 0 12px" }}>Comments</h3>
          {draft && <Composer onCancel={() => setDraft(null)} onSubmit={postThread} quote={draft.anchor.quote} />}
          {located.length === 0 && !draft && <p style={S.muted}>Select text in the doc to comment.</p>}
          {located.map(({ thread, status }) => (
            <ThreadCard
              key={thread.thread_id}
              thread={thread}
              orphaned={status === "orphaned"}
              active={active === thread.thread_id}
              onClick={() => setActive(thread.thread_id)}
              onReply={(b) => postReply(thread.thread_id, b)}
            />
          ))}
        </aside>
      </div>
    </div>
  );
}

function ThreadCard({ thread, orphaned, active, onClick, onReply }) {
  const [reply, setReply] = useState("");
  return (
    <div onClick={onClick} style={{ ...S.card, ...(active ? S.cardActive : {}) }}>
      <div style={S.quote}>
        {orphaned ? "⚠ orphaned · " : ""}“{thread.anchor.quote}”
      </div>
      {thread.comments.filter((c) => !c.deleted).map((c) => (
        <div key={c.id} style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 13 }}>{c.actor.name}</b>{c.edited ? " (edited)" : ""}
          <div style={{ fontSize: 14 }}>{c.body}</div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <input style={S.input} value={reply} placeholder="Reply…" onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && reply.trim()) { onReply(reply.trim()); setReply(""); } }} />
      </div>
    </div>
  );
}

function Composer({ quote, onCancel, onSubmit }) {
  const [body, setBody] = useState("");
  return (
    <div style={{ ...S.card, ...S.cardActive }}>
      <div style={S.quote}>“{quote}”</div>
      <textarea style={S.textarea} autoFocus value={body} placeholder="Leave a comment…" onChange={(e) => setBody(e.target.value)} />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={() => body.trim() && onSubmit(body.trim())}>Comment</button>
      </div>
    </div>
  );
}

const S = {
  app: { font: "15px/1.5 system-ui, sans-serif", height: "100vh", display: "flex", flexDirection: "column" },
  top: { padding: "10px 16px", borderBottom: "1px solid #ddd", background: "#faf8f3" },
  body: { flex: 1, display: "grid", gridTemplateColumns: "1fr 360px", overflow: "hidden" },
  docPane: { overflow: "auto", background: "#f7f3ea" },
  doc: { maxWidth: 720, margin: "0 auto", padding: "32px 48px", fontFamily: "Georgia, serif", fontSize: 18 },
  side: { borderLeft: "1px solid #ddd", background: "#211e18", color: "#ece5d6", padding: 16, overflow: "auto" },
  card: { background: "#2a261e", border: "1px solid #3a352b", borderRadius: 10, padding: 12, marginBottom: 10, cursor: "pointer" },
  cardActive: { borderColor: "#b07d34" },
  quote: { fontStyle: "italic", color: "#a59c89", borderLeft: "2px solid #b07d34", paddingLeft: 8, marginBottom: 8, fontSize: 13 },
  input: { flex: 1, background: "#211e18", border: "1px solid #3a352b", borderRadius: 8, padding: "6px 9px", color: "#ece5d6" },
  textarea: { width: "100%", minHeight: 60, background: "#211e18", border: "1px solid #3a352b", borderRadius: 8, padding: 8, color: "#ece5d6" },
  muted: { color: "#a59c89", fontStyle: "italic" },
};
