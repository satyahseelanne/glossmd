// apps/web/src/components/TopBar.jsx
//
// Top strip: brand, repo picker, branch picker, sync indicator, reviewer
// avatars, and (in OAuth mode) the signed-in user + sign out. The repo and
// branch pickers are native <select>s styled to read like the mockup's pills;
// they collapse to static text when there's only one option.

import React from "react";
import { avatarFor } from "../util/avatar.js";
import { api } from "../api.js";

export default function TopBar({
  repos,
  selRepo,
  onSelectRepo,
  branches,
  branch,
  onSelectBranch,
  me,
  authMode,
  knownActors,
}) {
  const actors = Array.from(new Map(knownActors.map((a) => [a.id, a])).values()).slice(0, 4);
  const manyRepos = repos && repos.length > 1;
  const manyBranches = branches && branches.length > 1;

  async function signOut() {
    await api.logout();
    window.location.reload();
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="glyph">¶</span> Gloss
      </div>

      {manyRepos ? (
        <div className="repo-pill select-pill" title="Switch repository">
          <span className="pill-ic">⌥</span>
          <select className="pill-select" value={selRepo?.slug ?? ""} onChange={(e) => onSelectRepo(e.target.value)}>
            {repos.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.slug}{r.private ? " · private" : ""}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="repo-pill">
          ⌥ <b>{selRepo?.slug ?? "…"}</b>
        </div>
      )}

      {manyBranches ? (
        <div className="branch select-pill" title="Switch branch">
          <span className="pill-ic">⎇</span>
          <select className="pill-select branch-select" value={branch} onChange={(e) => onSelectBranch(e.target.value)}>
            {branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="branch">⎇ {branch}</div>
      )}

      <div className="spacer" />
      <div className="sync">
        <span className="dot" /> Synced · committing to{" "}
        <b style={{ color: "var(--ink-soft)" }}>{branch}</b>
      </div>
      <div className="avatars">
        {actors.map((a) => {
          const av = avatarFor(a);
          return (
            <div key={a.id} className="av" style={{ background: av.color }} title={a.name}>
              {av.initials}
            </div>
          );
        })}
        {me && !actors.find((a) => a.id === me.id) && (
          <div className="av" style={{ background: avatarFor(me).color }} title={me.name}>
            {avatarFor(me).initials}
          </div>
        )}
      </div>
      {authMode === "oauth" && me && (
        <button className="signout" onClick={signOut} title={`Signed in as ${me.login ?? me.name}`}>
          {me.login ?? me.name} · Sign out
        </button>
      )}
    </header>
  );
}
