import { Link, Outlet } from "react-router-dom";

export function AppShell(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-lg font-semibold">
          Pencraft
        </Link>
        <span className="text-slate-500 text-xs">long-form in your voice</span>
      </header>
      <main className="px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
