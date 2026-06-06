// apps/web/src/components/Composer.jsx
//
// New-thread composer bound to a pending anchor (captured from the doc
// selection). Posts a create_thread action — which the reducer treats as the
// thread plus its seed comment in a single commit.

import React, { useState } from "react";

export default function Composer({ anchor, onCancel, onSubmit }) {
  const [body, setBody] = useState("");
  const trimmed = body.trim();

  function handleKey(e) {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && trimmed) onSubmit(trimmed);
  }

  return (
    <div className="thread active composer">
      <div className="quote">
        <span className="qn">¶ NEW ANCHOR · {(anchor?.commit ?? "").slice(0, 7) || "—"}</span>
        {anchor?.quote}
      </div>
      <textarea
        autoFocus
        value={body}
        placeholder="Leave a comment… (⌘/Ctrl+Enter to post)"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKey}
      />
      <div className="row">
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!trimmed} onClick={() => onSubmit(trimmed)}>
          Comment
        </button>
      </div>
    </div>
  );
}
