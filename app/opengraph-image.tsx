import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Blackletter share card, rendered once at build time from the bundled TTFs
// (satori cannot read woff2). See assets/fonts/OFL.txt for the font license.

export const alt = "tickerquill: portfolios, live prices, forecasts and an AI analyst. tickerquill.xanom.co";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

// Satori sizes text without kerning but draws it with kerning, which leaves
// uneven gaps between words at display sizes. One span per character draws
// each glyph alone, so what it draws matches what it measured.
function SerifLine({ text }: { text: string }) {
  return (
    <div style={{ display: "flex" }}>
      {Array.from(text).map((c, i) => (
        <span key={i}>{c === " " ? "\u00a0" : c}</span>
      ))}
    </div>
  );
}

export default async function OpengraphImage() {
  const [regular, medium, serif] = await Promise.all([
    font("Geist-Regular.ttf"),
    font("Geist-Medium.ttf"),
    font("GeistSerif-Regular.ttf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#000",
          color: "#FCFDFF",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 500 }}>
          <svg width="40" height="40" viewBox="0 0 32 32">
            <polyline points="5,23 11,17 15,20 21,11 25,13" fill="none" stroke="#FCFDFF" strokeWidth="2.5" strokeLinejoin="miter" strokeLinecap="square" />
            <rect x="24" y="9" width="5" height="5" fill="#4C8DFF" />
          </svg>
          tickerquill
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "Geist Serif", fontSize: 88, lineHeight: 1, letterSpacing: "-0.02em" }}>
          <SerifLine text="Portfolios, live prices," />
          <SerifLine text="forecasts and an AI analyst." />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(255,255,255,0.14)",
            paddingTop: 26,
            fontSize: 22,
            color: "#888E90",
          }}
        >
          <span>Runs on your own AI subscription.</span>
          <span style={{ color: "#A1A4A5" }}>tickerquill.xanom.co</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: medium, weight: 500, style: "normal" },
        { name: "Geist Serif", data: serif, weight: 400, style: "normal" },
      ],
    },
  );
}
