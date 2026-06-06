// apps/web/src/util/buildTree.js
//
// Turn a flat list of paths into a nested tree of directories + files for the
// file browser. Pure: no React, no DOM.
//
//   buildTree(["a/b.md", "a/c/d.md", "e.md"]) →
//     { dirs: { a: { dirs: { c: { dirs: {}, files: ["d.md"] } }, files: ["b.md"] } }, files: ["e.md"] }

export function buildTree(paths) {
  const root = { dirs: {}, files: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      node.dirs[part] = node.dirs[part] ?? { dirs: {}, files: [] };
      node = node.dirs[part];
    }
    node.files.push(parts[parts.length - 1]);
  }
  return root;
}
