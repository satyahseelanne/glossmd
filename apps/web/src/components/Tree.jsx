// apps/web/src/components/Tree.jsx
//
// File browser. Takes the flat path list returned by /tree and renders it as
// directories + files. Clicking a file selects it as the doc under review.

import React, { useMemo, useState } from "react";
import { buildTree } from "../util/buildTree.js";

export default function Tree({ paths, activePath, threadCounts, onSelect, branch }) {
  const tree = useMemo(() => buildTree(paths ?? []), [paths]);
  return (
    <nav className="tree">
      <h4>repo · {branch}</h4>
      <Folder
        node={tree}
        prefix=""
        depth={0}
        activePath={activePath}
        threadCounts={threadCounts}
        onSelect={onSelect}
        open
      />
    </nav>
  );
}

function Folder({ node, prefix, depth, activePath, threadCounts, onSelect, open: initialOpen }) {
  const dirNames = Object.keys(node.dirs).sort();
  const files = [...node.files].sort();

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
    </div>
  );
}

function Dir({ name, node, prefix, depth, activePath, threadCounts, onSelect, initialOpen }) {
  // Auto-open if the active file lives inside.
  const containsActive = activePath?.startsWith(prefix + "/");
  const [open, setOpen] = useState(initialOpen || containsActive);
  return (
    <>
      <div className="node dir" onClick={() => setOpen((o) => !o)}>
        <span className="ic">{open ? "▾" : "▸"}</span>
        <span>{name}</span>
      </div>
      {open && (
        <Folder
          node={node}
          prefix={prefix}
          depth={depth + 1}
          activePath={activePath}
          threadCounts={threadCounts}
          onSelect={onSelect}
        />
      )}
    </>
  );
}
