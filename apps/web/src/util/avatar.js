// apps/web/src/util/avatar.js
//
// Deterministic name → initials + colour. Keeps avatars stable across renders
// without needing the host to send a colour. Palette matches the mockup.

const PALETTE = [
  "#b07d34", // ochre
  "#3f7d74", // teal
  "#a8584e", // rose
  "#5f7d3f", // green
  "#4a6fa5", // blue
  "#8a5d22", // brown
  "#6b4f8f", // violet
  "#a87b3f", // amber
];

export function initials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function colorFor(seed) {
  if (!seed) return PALETTE[0];
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function avatarFor(actor) {
  const name = actor?.name ?? actor?.id ?? "?";
  return { initials: initials(name), color: colorFor(actor?.id ?? name) };
}
