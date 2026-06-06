// apps/web/src/components/Logo.jsx
//
// The Gloss brand mark. A rounded ochre tile holding a "marginalia" glyph:
// three lines of text with the middle one accented and a comment pin in the
// margin pointing at it — the act of glossing a line, in one symbol. Scales
// cleanly from the 26px top-bar mark to the 40px sign-in mark and the favicon.

import React from "react";

export default function Logo({ size = 26, rounded = 7, title = "Gloss" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className="gloss-logo"
    >
      <defs>
        <linearGradient id="glossTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c8902f" />
          <stop offset="1" stopColor="#8a5d22" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx={rounded} fill="url(#glossTile)" />
      {/* lines of text */}
      <g fill="#f7f3ea">
        <rect x="7" y="8.5" width="13" height="2.4" rx="1.2" opacity="0.65" />
        <rect x="7" y="14.8" width="10.5" height="2.6" rx="1.3" />
        <rect x="7" y="21.1" width="8.5" height="2.4" rx="1.2" opacity="0.65" />
      </g>
      {/* margin comment pin, pointing at the accented middle line */}
      <g>
        <circle cx="23.5" cy="16.1" r="3.4" fill="#f7f3ea" />
        <path d="M21.2 18.1 L20.2 20.4 L22.6 18.9 Z" fill="#f7f3ea" />
        <circle cx="23.5" cy="16.1" r="1.35" fill="#8a5d22" />
      </g>
    </svg>
  );
}
