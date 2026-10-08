"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AssistantProvider, useAssistant } from "./Assistant";
import { LivePricesProvider } from "./LivePrices";
import { PortfoliosProvider } from "./Portfolios";
import { SymbolSearch } from "./SymbolSearch";
import { FeedBadge } from "./ui";

function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { open, setOpen } = useAssistant();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">tickerdeck</Link>
        <nav className="nav" aria-label="Main">
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Portfolios</Link>
          <Link href="/settings" aria-current={pathname === "/settings" ? "page" : undefined}>Settings</Link>
        </nav>
        <span className="grow" />
        <FeedBadge />
        <SymbolSearch onSelect={(s) => s && router.push(`/s/${encodeURIComponent(s)}`)} />
        <button className="btn btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>Ask AI</button>
      </div>
    </header>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <LivePricesProvider>
      <PortfoliosProvider>
        <AssistantProvider>
          <TopBar />
          <main className="page">{children}</main>
        </AssistantProvider>
      </PortfoliosProvider>
    </LivePricesProvider>
  );
}
