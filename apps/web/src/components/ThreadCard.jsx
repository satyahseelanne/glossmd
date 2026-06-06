// apps/web/src/components/ThreadCard.jsx
//
// One review thread. Exercises all six action types:
//   * the seed comment is part of the create_thread action
//   * reply box → add_comment
//   * own comments get edit / delete buttons → edit_comment / delete_comment
//   * footer → resolve_thread / reopen_thread
// Resolved threads collapse like the mockup.

import React, { useState } from "react";
import { avatarFor } from "../util/avatar.js";
import { relativeTime } from "../util/relativeTime.js";

export default function ThreadCard({
  thread,
  index,
  me,
  active,
  orphaned,
  onActivate,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onReopen,
}) {
  const [reply, setReply] = useState("");
  const [collapsed, setCollapsed] = useState(thread.status === "resolved");

  function submitReply() {
    const body = reply.trim();
    if (!body) return;
    onReply(body);
    setReply("");
  }

  const resolved = thread.status === "resolved";
  const classes = [
    "thread",
    resolved ? "resolved" : "",
    resolved && collapsed ? "collapsed" : "",
    active ? "active" : "",
    orphaned ? "orphaned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      onClick={() => {
        if (resolved && collapsed) setCollapsed(false);
        onActivate();
      }}
    >
      {orphaned && <div className="orphaned-tag">⚠ ORPHANED</div>}
      <div className="quote">
        <span className="qn">
          {resolved ? "✓ RESOLVED" : `NOTE ${index + 1}`}
        </span>
        {thread.anchor?.quote ?? <i>(no quote)</i>}
      </div>

      <div className="body">
        {thread.comments.map((c) => (
          <Comment
            key={c.id}
            comment={c}
            me={me}
            onEdit={(body) => onEdit(c.id, body)}
            onDelete={() => onDelete(c.id)}
          />
        ))}
        {!resolved && (
          <div className="reply-box" onClick={(e) => e.stopPropagation()}>
            <input
              placeholder="Reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitReply()}
            />
            <button className="pill-btn" onClick={submitReply}>
              Send
            </button>
          </div>
        )}
      </div>

      <div className="thread-foot" onClick={(e) => e.stopPropagation()}>
        {resolved ? (
          <>
            <button className="pill-btn" onClick={onReopen}>
              ↺ Reopen
            </button>
            <button className="pill-btn" onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? "Expand" : "Collapse"}
            </button>
            <span className="resolved-tag">✓ Resolved</span>
          </>
        ) : (
          <>
            <button className="pill-btn solve" onClick={onResolve}>
              ✓ Resolve
            </button>
            <span className="ulid">{thread.thread_id.slice(0, 12)}…</span>
          </>
        )}
      </div>
    </div>
  );
}

function Comment({ comment, me, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const av = avatarFor(comment.actor);
  const mine = comment.actor?.id === me?.id;

  function saveEdit() {
    const next = draft.trim();
    if (!next) return;
    if (next !== comment.body) onEdit(next);
    setEditing(false);
  }

  if (comment.deleted) {
    return (
      <div className="cmt">
        <div className="av" style={{ background: av.color, opacity: 0.5 }}>{av.initials}</div>
        <div className="c-main">
          <div className="c-top">
            <span className="who">{comment.actor?.name ?? "?"}</span>
            <span className="when">{relativeTime(comment.ts)}</span>
          </div>
          <div className="text deleted">[deleted]</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cmt">
      <div className="av" style={{ background: av.color }}>{av.initials}</div>
      <div className="c-main">
        <div className="c-top">
          <span className="who">{comment.actor?.name ?? "?"}</span>
          <span className="when">{relativeTime(comment.ts)}</span>
          {comment.edited && <span className="edited">· edited</span>}
        </div>
        {editing ? (
          <>
            <textarea
              className="edit-area"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setEditing(false); setDraft(comment.body); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit();
              }}
            />
            <div className="row-actions" style={{ opacity: 1 }}>
              <button onClick={saveEdit}>Save</button>
              <button onClick={() => { setEditing(false); setDraft(comment.body); }}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="text">{comment.body}</div>
            {mine && (
              <div className="row-actions">
                <button onClick={() => setEditing(true)}>Edit</button>
                <button onClick={() => { if (confirm("Delete this comment?")) onDelete(); }}>
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
