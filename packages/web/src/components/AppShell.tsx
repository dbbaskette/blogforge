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
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Close the mobile menu whenever the route changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the change signal, not a value the effect reads.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // No top bar on the login page itself.
  if (location.pathname === "/login") return <></>;

  const navLinks: { to: string; label: string; end?: boolean }[] = [
    { to: "/", label: "Drafts", end: true },
    { to: "/voice", label: "Your Voice" },
    { to: "/help", label: "Help" },
    { to: "/settings", label: "Settings" },
    ...(user?.role === "admin" ? [{ to: "/admin", label: "Admin" }] : []),
  ];

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
            <span className="hidden sm:flex text-[11px] text-muted leading-none mt-0.5">
              a workshop ·{" "}
              <span className="font-mono" title={versionTitle()}>
                {versionLabel()}
              </span>
            </span>
          </span>
        </Link>
        {user && (
          <>
            {/* Desktop nav */}
            <nav className="hidden sm:flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Open command palette"
                title="Open command palette"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-[11px] text-muted hover:text-ink border border-ink/10 hover:border-ink/20 transition-colors"
              >
                Search
                <kbd className="font-mono text-[10px] text-muted-2">⌘K</kbd>
              </button>
              {navLinks.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className="nb-btn-ghost nb-btn nb-btn-sm">
                  {l.label}
                </NavLink>
              ))}
              <NavLink to="/compose" className="nb-btn nb-btn-sm nb-btn-primary ml-1">
                ✍ Compose
              </NavLink>
              <span className="inline-flex items-center gap-1.5 ml-1">
                {user.avatar_url && (
                  <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                )}
                <span className="text-xs text-muted">{user.github_login ?? user.email ?? "—"}</span>
              </span>
              <button type="button" onClick={() => void onSignOut()} className="nb-btn nb-btn-sm">
                Sign out
              </button>
            </nav>

            {/* Mobile controls */}
            <div className="flex items-center gap-1 sm:hidden">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Search drafts and navigate"
                title="Search"
                className="nb-icon-btn"
              >
                <SearchIcon />
              </button>
              <NavLink
                to="/compose"
                aria-label="Compose"
                className="nb-btn nb-btn-sm nb-btn-primary !px-2.5"
              >
                ✍
              </NavLink>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                className="nb-icon-btn"
              >
                {menuOpen ? "✕" : "☰"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Mobile menu — expands in the sticky bar so it never overlaps content. */}
      {user && menuOpen && (
        <nav
          id="mobile-menu"
          className="sm:hidden border-t border-rule bg-card max-h-[calc(100vh-3.5rem)] overflow-y-auto animate-fade-in"
          aria-label="Main navigation"
        >
          <div className="max-w-6xl mx-auto px-6 py-2 flex flex-col">
            {navLinks.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className="py-3 border-b border-rule text-sm font-medium text-ink no-underline"
              >
                {l.label}
              </NavLink>
            ))}
            <div className="flex items-center gap-3 py-3">
              {user.avatar_url && (
                <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full" />
              )}
              <span className="text-sm text-muted truncate">
                {user.github_login ?? user.email ?? "—"}
              </span>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="nb-btn nb-btn-sm ml-auto shrink-0"
              >
                Sign out
              </button>
            </div>
          </div>
        </nav>
      )}

      {user && paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </header>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
