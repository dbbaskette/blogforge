import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { logout } from "../api/auth";
import { useMe } from "../hooks/useMe";
import { useVersionCheck } from "../hooks/useVersionCheck";

export function AppShell(): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      <VersionBanner />
      <TopBar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function VersionBanner(): JSX.Element | null {
  const { stale } = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);

  if (!stale || dismissed) return null;

  return (
    <output
      className="block px-4 py-2.5 flex items-center justify-center gap-3 text-sm animate-fade-up"
      style={{ background: "#fdf6e6", borderBottom: "1px solid #f0d5a4", color: "#8a5d18" }}
    >
      <span>A new version is available.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="nb-btn nb-btn-sm nb-btn-primary"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-muted hover:text-ink transition-colors"
      >
        ✕
      </button>
    </output>
  );
}

function TopBar(): JSX.Element {
  const { user, refresh } = useMe();
  const navigate = useNavigate();
  const location = useLocation();

  const onSignOut = async (): Promise<void> => {
    try {
      await logout();
    } finally {
      refresh();
      navigate("/login");
    }
  };

  // No top bar on the login page itself.
  if (location.pathname === "/login") return <></>;

  return (
    <header className="border-b border-rule bg-white/60 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 h-14 flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <span className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-cobalt-500 to-cobalt-300 grid place-items-center text-white font-serif italic font-semibold text-base shadow-nb-cobalt">
            B
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-semibold text-[15px] text-ink tracking-tight">BlogForge</span>
            <span className="text-[11px] text-muted leading-none mt-0.5">a workshop</span>
          </span>
        </Link>
        {user && (
          <nav className="flex items-center gap-2">
            {user.role === "admin" && (
              <Link to="/admin" className="nb-btn-ghost nb-btn nb-btn-sm">
                Admin
              </Link>
            )}
            <Link to="/voice" className="nb-btn-ghost nb-btn nb-btn-sm">
              Your Voice
            </Link>
            <Link to="/settings" className="nb-btn-ghost nb-btn nb-btn-sm">
              Settings
            </Link>
            <span className="text-xs text-muted hidden sm:block">{user.email}</span>
            <button type="button" onClick={onSignOut} className="nb-btn nb-btn-sm">
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
