// apps/web/src/components/TopBar.jsx
//
// Top strip with brand, repo pill, branch, sync indicator, and the avatar
// cluster for currently-known reviewers (drawn from threads). Cosmetic but it
// sells the "real product" feel from the mockup.

import React from "react";
import { avatarFor } from "../util/avatar.js";
import { api } from "../api.js";

export default function TopBar({ branch, repo, me, authMode, knownActors }) {
  const actors = Array.from(new Map(knownActors.map((a) => [a.id, a])).values()).slice(0, 4);
  async function signOut() {
    await api.logout();
    window.location.reload();
  }
  return (
    <header className="topbar">
      <div className="brand">
        <span className="glyph">¶</span> Gloss
      </div>
      <div className="repo-pill">
        ⌥ <b>{repo}</b>
      </div>
      <div className="branch">⎇ {branch}</div>
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
