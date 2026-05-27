import { Link, Outlet } from "react-router-dom";

export function AppShell(): JSX.Element {
  return (
    <div className="min-h-screen bg-ink text-cream flex flex-col">
      <Masthead />
      <main className="px-8 lg:px-16 py-10 flex-1">
        <Outlet />
      </main>
      <Colophon />
    </div>
  );
}

function Masthead(): JSX.Element {
  return (
    <header className="px-8 lg:px-16 pt-8 pb-6">
      <div className="flex items-baseline justify-between">
        <Link to="/" className="group inline-flex items-baseline gap-3">
          <span className="wordmark text-3xl text-cream-2 group-hover:text-vermilion-400 transition-colors duration-300">
            Pencraft
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide-3 text-muted">
            a writing tool
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-3 text-[10px] font-mono uppercase tracking-wide-3 text-muted">
          <span>est. 2026</span>
          <span className="text-muted-2">·</span>
          <span>vol. 01</span>
        </div>
      </div>
      <div className="rule mt-6" />
    </header>
  );
}

function Colophon(): JSX.Element {
  return (
    <footer className="px-8 lg:px-16 pb-10 pt-16">
      <div className="rule mb-4" />
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wide-3 text-muted-2">
        <span>Pencraft</span>
        <span>set in Fraunces &amp; Newsreader</span>
      </div>
    </footer>
  );
}
