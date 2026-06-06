// apps/web/src/components/Sidebar.jsx
//
// The right column: header + count + filter + thread list. Each thread is
// wrapped in an ErrorBoundary so one bad action card can never blank the
// whole sidebar (the bug we hit live this session).

import React, { useEffect, useRef } from "react";
import ThreadCard from "./ThreadCard.jsx";
import Composer from "./Composer.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
];

export default function Sidebar({
  threads,
  orphanIds,
  draft,
  filter,
  activeThread,
  focus,
  me,
  onFilterChange,
  onActivate,
  onStartReply,
  onEdit,
  onDelete,
  onResolve,
  onReopen,
  onCancelDraft,
  onSubmitDraft,
}) {
  const threadsRef = useRef(null);
  const openCount = threads.filter((t) => t.status === "open").length;

  // Scroll the matching card into view when an inline anchor asks us to
  // (focus.pane === "sidebar").
  useEffect(() => {
    if (!focus || focus.pane !== "sidebar" || !threadsRef.current) return;
    const card = threadsRef.current.querySelector(`.thread[data-thread="${focus.id}"]`);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const visible = threads.filter((t) => {
    if (filter === "all") return true;
    if (filter === "open") return t.status === "open";
    if (filter === "resolved") return t.status === "resolved";
    return true;
  });

  // Stable index for the pin badge: based on appearance order in the doc text
  // (which we approximate by creation order — the reducer canonicalizes that).
  const indexById = new Map();
  threads.forEach((t, i) => indexById.set(t.thread_id, i));

  return (
    <aside className="side">
      <div className="side-head">
        <h3>Comments</h3>
        <span className="count">{openCount} open</span>
        <div className="filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={filter === f.id ? "on" : ""}
              onClick={() => onFilterChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="threads" ref={threadsRef}>
        {draft && (
          <ErrorBoundary label="composer">
            <Composer
              anchor={draft.anchor}
              onCancel={onCancelDraft}
              onSubmit={onSubmitDraft}
            />
          </ErrorBoundary>
        )}

        {visible.length === 0 && !draft && (
          <div className="empty">
            {filter === "all"
              ? "No comments yet — select text in the doc to leave one."
              : `No ${filter} threads.`}
          </div>
        )}

        {visible.map((t) => (
          <ErrorBoundary key={t.thread_id} label={`thread ${t.thread_id.slice(0, 8)}…`}>
            <ThreadCard
              thread={t}
              index={indexById.get(t.thread_id) ?? 0}
              me={me}
              active={activeThread === t.thread_id}
              orphaned={orphanIds?.includes(t.thread_id)}
              onActivate={() => onActivate(t.thread_id)}
              onReply={(body) => onStartReply(t.thread_id, body)}
              onEdit={(commentId, body) => onEdit(commentId, body)}
              onDelete={(commentId) => onDelete(commentId)}
              onResolve={() => onResolve(t.thread_id)}
              onReopen={() => onReopen(t.thread_id)}
            />
          </ErrorBoundary>
        ))}
      </div>
    </aside>
  );
}
