// apps/web/src/components/DocumentPane.jsx
//
// The middle column: rendered markdown with inline anchor decorations. The
// markdown is injected as an HTML string (so we can post-process the DOM with
// @gloss/anchor's highlightRanges without re-traversing a React tree), then a
// useEffect re-locates every thread anchor in the current rendered plaintext
// and wraps each range with <span class="anchor">. The same effect installs
// a click handler on each span that activates the corresponding thread.
//
// Selection → floating "Comment" button uses @gloss/anchor's captureSelection
// to produce a stored selector at the current commit; the button hands the
// captured anchor to the parent's onStartThread, which opens the composer.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import {
  resolveAnchor,
  captureSelection,
  highlightRanges,
  setActiveHighlight,
} from "@gloss/anchor";

export default function DocumentPane({
  docPath,
  file,
  threads,
  activeThread,
  focus,
  onSelectThread,
  onStartThread,
  onOrphans,
}) {
  const docRef = useRef(null);
  const [floatBtn, setFloatBtn] = useState(null); // { x, y, anchor } | null

  const html = useMemo(() => (file ? marked.parse(file.content) : ""), [file]);

  // Decorate inline anchors after every render of the doc html or threads change.
  useEffect(() => {
    const root = docRef.current;
    if (!root) return;

    const rendered = root.textContent ?? "";
    const ranges = [];
    const orphans = [];
    threads.forEach((t, idx) => {
      const anchor = t.anchor || {};
      const located = resolveAnchor(rendered, {
        quote: anchor.quote,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        textPosition: anchor.textPosition ?? anchor.text_position,
      });
      if (!located.range) {
        orphans.push(t.thread_id);
        return;
      }
      ranges.push({
        threadId: t.thread_id,
        start: located.range.start,
        end: located.range.end,
        status: t.status === "resolved" ? "resolved" : located.status, // "exact" | "approximate" | "resolved"
        pin: t.status === "resolved" ? "✓" : idx + 1,
      });
    });

    onOrphans?.(orphans);
    const cleanup = highlightRanges(root, ranges, (threadId) => onSelectThread(threadId));
    setActiveHighlight(root, activeThread);
    return cleanup;
  }, [html, threads, onSelectThread, onOrphans]);

  // Cheap restyle when activeThread changes without re-wrapping.
  useEffect(() => {
    if (docRef.current) setActiveHighlight(docRef.current, activeThread);
  }, [activeThread]);

  // Scroll the anchor span into view when a sidebar card asks us to (focus.pane
  // === "doc"). The first matching span for the thread is enough.
  useEffect(() => {
    if (!focus || focus.pane !== "doc" || !docRef.current) return;
    const span = docRef.current.querySelector(`.anchor[data-thread="${focus.id}"]`);
    if (span) span.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  // Selection → floating "Comment" button.
  function handleMouseUp(e) {
    if (e.target?.closest?.(".float-btn")) return;
    // tiny delay so the selection has settled
    setTimeout(() => {
      const root = docRef.current;
      if (!root || !file) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setFloatBtn(null);
        return;
      }
      if (!root.contains(sel.anchorNode)) {
        setFloatBtn(null);
        return;
      }
      const anchor = captureSelection(root, file.commit, docPath);
      if (!anchor) {
        setFloatBtn(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setFloatBtn({
        x: rect.left + rect.width / 2,
        y: rect.top,
        anchor,
      });
    }, 10);
  }

  function startComment() {
    if (!floatBtn) return;
    onStartThread(floatBtn.anchor);
    setFloatBtn(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <main className="doc-wrap" onMouseUp={handleMouseUp}>
      <div className="doc-head">
        <div className="inner">
          <span className="crumb">
            {docPath ? formatCrumb(docPath) : <i>select a file…</i>}
          </span>
          <span className="commit-tag">
            anchored to <code>{(file?.commit ?? "…").slice(0, 7)}</code>
          </span>
        </div>
      </div>
      <article
        ref={docRef}
        className="doc"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {floatBtn && (
        <button
          className="float-btn"
          style={{ left: floatBtn.x, top: floatBtn.y, display: "flex" }}
          onMouseDown={(e) => e.preventDefault()} // don't clear selection
          onClick={startComment}
        >
          💬 Comment
        </button>
      )}
    </main>
  );
}

function formatCrumb(p) {
  const parts = p.split("/");
  const last = parts.pop();
  return (
    <>
      {parts.length ? parts.join(" / ") + " / " : ""}
      <b>{last}</b>
    </>
  );
}
