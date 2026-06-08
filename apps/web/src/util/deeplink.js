// apps/web/src/util/deeplink.js
//
// Shareable deep links. The reviewer's current location — repo, branch, document,
// and (optionally) the focused comment thread — is mirrored into the URL query
// string so a link can be copied and sent. Opening that link restores the same
// view. Pure: only reads/writes window.location and history.
//
//   ?repo=owner/name&branch=main&path=design/spec.md&thread=01HXY…
//
// `repo` is the full slug (owner/name). `thread` is optional.

/** Parse the current URL into a deep-link target. Missing parts are undefined. */
export function readDeepLink() {
  const q = new URLSearchParams(window.location.search);
  const slug = q.get("repo") || undefined;     // "owner/name"
  const branch = q.get("branch") || undefined;
  const path = q.get("path") || undefined;
  const thread = q.get("thread") || undefined;
  return { slug, branch, path, thread };
}

/**
 * Write the current view to the URL without reloading. Uses replaceState so we
 * don't spam the back button on every selection. Omits empty parts.
 *
 * @param {{slug?:string, branch?:string, path?:string, thread?:string}} target
 */
export function writeDeepLink({ slug, branch, path, thread }) {
  const q = new URLSearchParams();
  if (slug) q.set("repo", slug);
  if (branch) q.set("branch", branch);
  if (path) q.set("path", path);
  if (thread) q.set("thread", thread);
  const qs = q.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

/** The absolute URL for a given view — for the "Copy link" button. */
export function buildShareUrl({ slug, branch, path, thread }) {
  const q = new URLSearchParams();
  if (slug) q.set("repo", slug);
  if (branch) q.set("branch", branch);
  if (path) q.set("path", path);
  if (thread) q.set("thread", thread);
  return `${window.location.origin}${window.location.pathname}?${q.toString()}`;
}
