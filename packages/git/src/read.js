// @gloss/git — src/read.js
//
// The read path. Fetch the latest checkpoint plus the un-folded log tail for a
// document, then hand them to @gloss/core's loader. The host knows nothing about
// the protocol; it just lists and reads files.

import { load } from "@gloss/core";
import { logDir, checkpointDir } from "./paths.js";

/**
 * @typedef {object} ReadHost
 * @property {(dir: string) => Promise<string[]>} listDir - file paths under dir
 * @property {(path: string) => Promise<string|null>} readFile - file contents or null
 */

/**
 * Read raw review files for a document: the latest checkpoint and the log tail.
 * @param {ReadHost} host
 * @param {string} docPath
 * @returns {Promise<{checkpoint: object|null, logTail: object[]}>}
 */
export async function readReviewFiles(host, docPath) {
  const cpDir = checkpointDir(docPath);
  const cpFiles = (await host.listDir(cpDir)) ?? [];
  // checkpoints are ULID-named; the max id is the latest. No pointer file.
  const latestCp = cpFiles
    .filter((p) => p.endsWith(".json"))
    .sort()
    .at(-1);

  let checkpoint = null;
  if (latestCp) {
    const raw = await host.readFile(latestCp);
    if (raw) checkpoint = JSON.parse(raw);
  }

  const logFiles = (await host.listDir(logDir(docPath))) ?? [];
  const logTail = [];
  for (const p of logFiles.filter((p) => p.endsWith(".json")).sort()) {
    const raw = await host.readFile(p);
    if (raw) logTail.push(JSON.parse(raw));
  }

  return { checkpoint, logTail };
}

/**
 * Full load: raw files → materialized review state.
 * @param {ReadHost} host
 * @param {string} docPath
 * @returns {Promise<object>} review state from @gloss/core
 */
export async function loadReviews(host, docPath) {
  const { checkpoint, logTail } = await readReviewFiles(host, docPath);
  return load(checkpoint, logTail);
}
