// @gloss/git — src/paths.js
// Where a document's review data lives in the repo.

export function reviewDir(docPath) {
  return `.gloss/${docPath}`;
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
