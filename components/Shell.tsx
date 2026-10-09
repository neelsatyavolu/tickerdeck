"use client";

import Link from "next/link";
import { useEffect } from "react";
import { loadListings } from "@/lib/client/symbolIndex";
import { usePathname, useRouter } from "next/navigation";
import { AssistantProvider } from "./Assistant";
import { LivePricesProvider } from "./LivePrices";
import { PortfoliosProvider } from "./Portfolios";
import { SymbolSearch } from "./SymbolSearch";
import { DashboardsProvider } from "./Dashboards";
import { WatchlistProvider } from "./Watchlist";
import { FeedBadge } from "./ui";
import { Footer } from "./Footer";

function TopBar() {
  const pathname = usePathname();
  const router = useRouter();

  // Warm the search index in the background so the first search is instant.
  useEffect(() => {
    const t = setTimeout(() => loadListings().catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, []);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">tickerdeck</Link>
        <nav className="nav" aria-label="Main">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Home</Link>
          <Link href="/portfolios" aria-current={pathname === "/portfolios" || pathname.startsWith("/p/") ? "page" : undefined}>Portfolios</Link>
          <Link href="/d" aria-current={pathname.startsWith("/d") ? "page" : undefined}>Dashboards</Link>
          <Link href="/watchlist" aria-current={pathname === "/watchlist" ? "page" : undefined}>Watchlist</Link>
          <Link href="/news" aria-current={pathname === "/news" ? "page" : undefined}>News</Link>
          <Link href="/settings" aria-current={pathname === "/settings" ? "page" : undefined}>Settings</Link>
        </nav>
        <span className="grow" />
        <FeedBadge />
        <SymbolSearch prefetch onSelect={(s) => s && router.push(`/s/${encodeURIComponent(s)}`)} />
      </div>
    </header>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <LivePricesProvider>
      <PortfoliosProvider>
        <WatchlistProvider>
          <DashboardsProvider>
            <AssistantProvider>
              <TopBar />
              <main className="page">{children}</main>
              <Footer />
            </AssistantProvider>
          </DashboardsProvider>
        </WatchlistProvider>
      </PortfoliosProvider>
    </LivePricesProvider>
  );
}
