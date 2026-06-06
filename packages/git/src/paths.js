// @gloss/git — src/paths.js
// Where a document's review data lives in the repo.
//
// The review log is co-located *beside* the document — a `.gloss/` directory in
// the same folder as the doc, namespaced by the doc's filename. So comments for
// `design/design.md` live in `design/.gloss/design.md/`. This is the Delta Lake
// locality property adapted to single-file docs: moving or copying a folder
// carries its review log with it, and the comments never pollute the doc's diff.

/** Split a doc path into its directory and filename. */
function splitDoc(docPath) {
  const i = docPath.lastIndexOf("/");
  return i === -1
    ? { dir: "", name: docPath }
    : { dir: docPath.slice(0, i), name: docPath.slice(i + 1) };
}

export function reviewDir(docPath) {
  const { dir, name } = splitDoc(docPath);
  return dir ? `${dir}/.gloss/${name}` : `.gloss/${name}`;
}
export function logPath(docPath, actionId) {
  return `${reviewDir(docPath)}/_log/${actionId}.json`;
}
export function logDir(docPath) {
  return `${reviewDir(docPath)}/_log`;
}
export function checkpointPath(docPath, checkpointId) {
  return `${reviewDir(docPath)}/_checkpoints/${checkpointId}.json`;
}
export function checkpointDir(docPath) {
  return `${reviewDir(docPath)}/_checkpoints`;
}

/** True if `path` is a log action file under the given document's review dir. */
export function isLogFile(docPath, path) {
  return path.startsWith(`${logDir(docPath)}/`) && path.endsWith(".json");
}
