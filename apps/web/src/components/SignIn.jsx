// apps/web/src/components/SignIn.jsx
//
// Shown in OAuth mode before the reviewer has authenticated. A full-page
// navigation to /auth/login starts the GitHub OAuth round trip; the server sets
// an HttpOnly session cookie and redirects back. The token never reaches here.

import React from "react";
import Logo from "./Logo.jsx";

export default function SignIn() {
  return (
    <div className="signin">
      <div className="signin-card">
        <div className="signin-brand">
          <Logo size={34} rounded={9} /> Gloss
        </div>
        <p className="signin-sub">
          Sign in to review markdown in your repositories — comments commit as you.
        </p>
        <a className="signin-btn" href="/auth/login">
          Sign in with GitHub
        </a>
        <p className="signin-fine">
          You'll authorize Gloss to read and write repositories on your behalf.
          Your token is held server-side and never sent to the browser.
        </p>
      </div>
    </div>
  );
}
