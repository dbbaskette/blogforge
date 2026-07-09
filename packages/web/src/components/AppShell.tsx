import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { logout } from "../api/auth";
import { useMe } from "../hooks/useMe";
import { useVersionCheck } from "../hooks/useVersionCheck";
import { versionLabel, versionTitle } from "../lib/version";
import { CommandPalette } from "./CommandPalette";

export function AppShell(): JSX.Element {
  return (
    <div className="min-h-screen text-ink flex flex-col">
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
      style={{ background: "#fbf1de", borderBottom: "1px solid #f3d89b", color: "#92600a" }}
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
  const [paletteOpen, setPaletteOpen] = useState(false);

  const onSignOut = async (): Promise<void> => {
    try {
      await logout();
    } finally {
      refresh();
      navigate("/login");
    }
  };

  // Global ⌘K / Ctrl+K opens the command palette (signed-in users only).
  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [user]);

  // No top bar on the login page itself.
  if (location.pathname === "/login") return <></>;

  return (
    <header className="glass-bar sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 h-14 flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <span className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-cobalt-500 to-cobalt-300 grid place-items-center text-white font-serif italic font-semibold text-base shadow-nb-cobalt">
            B
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-serif font-semibold text-[16px] text-ink tracking-tight">
              BlogForge
            </span>
            <span className="text-[11px] text-muted leading-none mt-0.5">
              a workshop ·{" "}
              <span className="font-mono" title={versionTitle()}>
                {versionLabel()}
              </span>
            </span>
          </span>
        </Link>
        {user && (
          <nav className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
              title="Open command palette"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[11px] text-muted hover:text-ink border border-ink/10 hover:border-ink/20 transition-colors"
            >
              Search
              <kbd className="font-mono text-[10px] text-muted-2" aria-hidden="true">
                ⌘K
              </kbd>
            </button>
            <NavLink to="/" end className="nb-btn-ghost nb-btn nb-btn-sm">
              Drafts
            </NavLink>
            <NavLink to="/voice" className="nb-btn-ghost nb-btn nb-btn-sm">
              Your Voice
            </NavLink>
            <NavLink to="/help" className="nb-btn-ghost nb-btn nb-btn-sm">
              Help
            </NavLink>
            <NavLink to="/settings" className="nb-btn-ghost nb-btn nb-btn-sm">
              Settings
            </NavLink>
            {user.role === "admin" && (
              <NavLink to="/admin" className="nb-btn-ghost nb-btn nb-btn-sm">
                Admin
              </NavLink>
            )}
            <NavLink to="/compose" className="nb-btn nb-btn-sm nb-btn-primary ml-1">
              ✍ Compose
            </NavLink>
            <span className="inline-flex items-center gap-1.5 hidden sm:inline-flex ml-1">
              {user.avatar_url && (
                <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
              )}
              <span className="text-xs text-muted">{user.github_login ?? user.email ?? "—"}</span>
            </span>
            <button type="button" onClick={onSignOut} className="nb-btn nb-btn-sm">
              Sign out
            </button>
          </nav>
        )}
      </div>
      {user && paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </header>
  );
}
