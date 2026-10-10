import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { ThemeSync } from "@/components/Theme";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";
import "./themes.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "tickerquill",
  description: "Track portfolios with live prices, forecasts and an AI analyst on your own subscription.",
  // Link previews. The image is app/opengraph-image.png; metadataBase makes its URL absolute.
  metadataBase: new URL("https://tickerquill.n3el.dev"),
  openGraph: {
    title: "tickerquill — track portfolios with forecasts and an AI analyst",
    description: "Track portfolios with live prices, forecasts and an AI analyst on your own subscription.",
    url: "/",
    siteName: "tickerquill",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint; see lib/theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
