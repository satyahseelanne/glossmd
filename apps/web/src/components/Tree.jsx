// apps/web/src/components/Tree.jsx
//
// File browser. Takes the flat path list returned by /tree and renders it as
// directories + files. Clicking a file selects it as the doc under review.
//
// When onNewDoc is provided (the reviewer is signed in), the header gets a
// "+ New" action and every folder gets a "+" on hover. Either opens an inline
// input row (no browser dialog) under that folder; submitting commits a new .md
// via the parent. Folders in the path are created implicitly since git has no
// empty directories.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildTree } from "../util/buildTree.js";

export default function Tree({ paths, activePath, threadCounts, onSelect, onNewDoc, branch }) {
  const tree = useMemo(() => buildTree(paths ?? []), [paths]);

  // The folder prefix an inline "new document" input is open under, or null.
  // "" means the repo root. Only one input is open at a time.
  const [creatingIn, setCreatingIn] = useState(null);

  function startCreate(prefix = "") {
    if (onNewDoc) setCreatingIn(prefix);
  }
  function submitCreate(prefix, name) {
    const trimmed = name.trim();
    setCreatingIn(null);
    if (trimmed && onNewDoc) onNewDoc(prefix ? `${prefix}/${trimmed}` : trimmed);
  }

  const newDoc = onNewDoc
    ? { creatingIn, startCreate, submitCreate, cancelCreate: () => setCreatingIn(null) }
    : null;

  return (
    <nav className="tree">
      <h4>
        <span>repo · {branch}</span>
        {onNewDoc && (
          <button className="tree-new" title="New document" onClick={() => startCreate("")}>
            + New
          </button>
        )}
      </h4>
      <Folder
        node={tree}
        prefix=""
        depth={0}
        activePath={activePath}
        threadCounts={threadCounts}
        onSelect={onSelect}
        newDoc={newDoc}
        open
      />
    </nav>
  );
}

// Inline row with a text input for naming a new document. Enter submits, Escape
// or blur cancels. Autofocuses on mount.
function NewDocInput({ prefix, onSubmit, onCancel }) {
  const ref = useRef(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="node newdoc">
      <span className="ic">○</span>
      <input
        ref={ref}
        className="newdoc-input"
        placeholder={prefix ? `name.md  ·  in ${prefix}/` : "design/spec.md"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit(value);
          else if (e.key === "Escape") onCancel();
        }}
        onBlur={() => (value.trim() ? onSubmit(value) : onCancel())}
      />
    </div>
  );
}

function Folder({ node, prefix, depth, activePath, threadCounts, onSelect, newDoc, open: initialOpen }) {
  const dirNames = Object.keys(node.dirs).sort();
  const files = [...node.files].sort();
  const showInput = newDoc && newDoc.creatingIn === prefix;

  return (
    <div className={depth > 0 ? "indent" : ""}>
      {dirNames.map((name) => (
        <Dir
          key={name}
          name={name}
          node={node.dirs[name]}
          prefix={prefix ? `${prefix}/${name}` : name}
          depth={depth}
          activePath={activePath}
          threadCounts={threadCounts}
          onSelect={onSelect}
          newDoc={newDoc}
          initialOpen={initialOpen}
        />
      ))}
      {files.map((name) => {
        const full = prefix ? `${prefix}/${name}` : name;
        const isActive = full === activePath;
        const count = threadCounts?.[full] ?? 0;
        return (
          <div
            key={name}
            className={`node file${isActive ? " active" : ""}`}
            onClick={() => onSelect(full)}
            title={full}
          >
            <span className="ic">{isActive ? "◆" : "○"}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
            {count > 0 && <span className="badge">{count}</span>}
          </div>
        );
      })}
      {showInput && (
        <NewDocInput
          prefix={prefix}
          onSubmit={(name) => newDoc.submitCreate(prefix, name)}
          onCancel={newDoc.cancelCreate}
        />
      )}
    </div>
  );
}

function Dir({ name, node, prefix, depth, activePath, threadCounts, onSelect, newDoc, initialOpen }) {
  // Auto-open if the active file lives inside, or a new-doc input is open at or
  // below this folder.
  const containsActive = activePath?.startsWith(prefix + "/");
  const creatingHere =
    newDoc?.creatingIn != null &&
    (newDoc.creatingIn === prefix || newDoc.creatingIn.startsWith(prefix + "/"));
  const [open, setOpen] = useState(initialOpen || containsActive);
  const isOpen = open || creatingHere;
  return (
    <>
      <div className="node dir" onClick={() => setOpen((o) => !o)}>
        <span className="ic">{isOpen ? "▾" : "▸"}</span>
        <span className="dir-name">{name}</span>
        {newDoc && (
          <button
            className="dir-new"
            title={`New document in ${prefix}/`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
              newDoc.startCreate(prefix);
            }}
          >
            +
          </button>
        )}
      </div>
      {isOpen && (
        <Folder
          node={node}
          prefix={prefix}
          depth={depth + 1}
          activePath={activePath}
          threadCounts={threadCounts}
          onSelect={onSelect}
          newDoc={newDoc}
        />
      )}
    </>
  );
}
