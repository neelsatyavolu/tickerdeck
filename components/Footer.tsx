const REPO_URL = "https://github.com/neelsatyavolu/tickerdeck";

export function Footer() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} tickerdeck · MIT License · Not investment advice</span>
      <nav aria-label="Footer">
        <span>Data: Nasdaq, Finnhub, CNBC</span>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
      </nav>
    </footer>
  );
}
