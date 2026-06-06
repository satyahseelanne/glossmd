// apps/web/src/components/Toast.jsx
//
// Transient feedback after a commit lands. Shows the action type + ULID — a
// nod to the protocol: every UI action is a real file on the branch.

import React, { useEffect } from "react";

export default function Toast({ toast, onClear }) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => onClear(), 2600);
    return () => clearTimeout(id);
  }, [toast, onClear]);

  return (
    <div className={`toast${toast ? " show" : ""}`}>
      {toast && (
        <>
          ✓ {toast.message}{" "}
          <code>
            {toast.action}.json · {toast.id.slice(0, 10)}
          </code>
        </>
      )}
    </div>
  );
}
