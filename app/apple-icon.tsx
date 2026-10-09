import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon: the favicon mark at 180px (iOS doesn't use SVG icons).
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0E0E0D" }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <polyline points="5,23 11,17 15,20 21,11 25,13" fill="none" stroke="#F2F0EA" strokeWidth="2.5" strokeLinejoin="miter" strokeLinecap="square" />
          <rect x="24" y="9" width="5" height="5" fill="#4C8DFF" />
        </svg>
      </div>
    ),
    size,
  );
}
