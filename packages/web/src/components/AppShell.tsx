import { Link, Outlet } from "react-router-dom";

export function AppShell(): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <TopBar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function TopBar(): JSX.Element {
  return (
    <header className="border-b border-rule bg-white/60 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 h-14 flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <span className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-cobalt-500 to-cobalt-300 grid place-items-center text-white font-serif italic font-semibold text-base shadow-nb-cobalt">
            P
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-semibold text-[15px] text-ink tracking-tight">Pencraft</span>
            <span className="text-[11px] text-muted leading-none mt-0.5">a workshop</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <a
            href="http://localhost:7878"
            target="_blank"
            rel="noreferrer"
            className="nb-btn-ghost nb-btn nb-btn-sm"
          >
            myvoice ↗
          </a>
        </nav>
      </div>
    </header>
  );
}
