import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { type DraftSummary, downloadDraftUrl, listDrafts } from "../api/drafts";
import { useDialogA11y } from "./ui/useDialogA11y";

/** Window-level event the draft workspace listens on to open its panels. */
export const PALETTE_ACTION_EVENT = "bf:palette-action";

interface Command {
  /** Stable key for React + listbox option ids. */
  key: string;
  /** Leading glyph rendered decoratively (aria-hidden). */
  glyph: string;
  label: string;
  hint?: string;
  /** Navigation target; running the command navigates here + closes. */
  to?: string;
  /** Inline action; running it fires + closes (used alongside or instead of `to`). */
  run?: () => void;
}

const STATIC_COMMANDS: Command[] = [
  { key: "new", glyph: "✍", label: "New piece", hint: "Compose", to: "/compose" },
  { key: "drafts", glyph: "📝", label: "Your drafts", hint: "Home", to: "/" },
  { key: "voice", glyph: "🎙", label: "Your Voice", to: "/voice" },
  { key: "settings", glyph: "⚙", label: "Settings", to: "/settings" },
  { key: "trash", glyph: "🗑", label: "Trash", to: "/trash" },
];

/** Actions that operate on the draft you're currently viewing. */
const DRAFT_ACTIONS: { key: string; glyph: string; label: string; event: string }[] = [
  { key: "act-proofread", glyph: "🔍", label: "Proofread this draft", event: "proofread" },
  { key: "act-headlines", glyph: "💡", label: "Headline lab", event: "headlines" },
  { key: "act-repurpose", glyph: "♻️", label: "Repurpose…", event: "repurpose" },
  { key: "act-publish", glyph: "🚀", label: "Publish to GitHub…", event: "publish" },
];

function dispatchPaletteAction(event: string): void {
  window.dispatchEvent(new CustomEvent(PALETTE_ACTION_EVENT, { detail: { action: event } }));
}

/** Max dynamic "Open: …" entries shown after filtering. */
const MAX_DRAFTS = 10;

export function CommandPalette({ onClose }: { onClose: () => void }): JSX.Element {
  const ref = useDialogA11y(true, onClose);
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  // The id of the draft currently open, if any — unlocks per-draft actions.
  const draftId = /^\/drafts\/([^/]+)$/.exec(location.pathname)?.[1];

  // Load drafts once on open; ignore failures so the palette stays usable.
  useEffect(() => {
    const controller = new AbortController();
    listDrafts({ signal: controller.signal })
      .then(setDrafts)
      .catch(() => {
        /* network/auth errors leave the static commands available */
      });
    return () => controller.abort();
  }, []);

  const commands = useMemo<Command[]>(() => {
    const draftCommands: Command[] = drafts.map((d) => ({
      key: `draft-${d.id}`,
      glyph: "📄",
      label: `Open: ${d.title || "Untitled"}`,
      to: `/drafts/${d.id}`,
    }));
    const contextual: Command[] = draftId
      ? [
          ...DRAFT_ACTIONS.map((a) => ({
            key: a.key,
            glyph: a.glyph,
            label: a.label,
            hint: "This draft",
            run: () => dispatchPaletteAction(a.event),
          })),
          {
            key: "act-download",
            glyph: "⬇️",
            label: "Download .md",
            hint: "This draft",
            run: () => window.location.assign(downloadDraftUrl(draftId)),
          },
        ]
      : [];
    return [...STATIC_COMMANDS, ...contextual, ...draftCommands];
  }, [drafts, draftId]);

  const results = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    // Cap only the dynamic draft entries; static + context commands always remain.
    const headHits = filtered.filter((c) => !c.key.startsWith("draft-"));
    const draftHits = filtered.filter((c) => c.key.startsWith("draft-")).slice(0, MAX_DRAFTS);
    return [...headHits, ...draftHits];
  }, [commands, query]);

  // Keep the highlighted index in range as results change.
  useEffect(() => {
    setActive((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  // Scroll the highlighted row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (cmd: Command): void => {
    cmd.run?.();
    if (cmd.to) navigate(cmd.to);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[active];
      if (cmd) run(cmd);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 backdrop-blur-sm animate-fade-in p-4 pt-[12vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        className="nb-card w-[560px] max-w-full p-0 text-ink animate-fade-up overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="px-4 pt-4 pb-3 border-b border-ink/10">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search commands and drafts…"
            aria-label="Search commands and drafts"
            aria-controls="command-palette-list"
            role="combobox"
            aria-expanded="true"
            aria-activedescendant={
              results.length > 0 ? `command-option-${results[active]?.key}` : undefined
            }
            className="w-full bg-transparent text-[15px] text-ink placeholder:text-muted outline-none"
          />
        </div>
        <ul
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-[52vh] overflow-y-auto py-2"
        >
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">No matches</li>
          ) : (
            results.map((cmd, i) => {
              const selected = i === active;
              return (
                <li
                  key={cmd.key}
                  id={`command-option-${cmd.key}`}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  onClick={() => run(cmd)}
                  onMouseMove={() => setActive(i)}
                  className={`mx-2 px-3 py-2 rounded-[10px] flex items-center gap-3 cursor-pointer transition-colors ${
                    selected ? "bg-cobalt-500/10 text-ink" : "text-ink-2"
                  }`}
                >
                  <span aria-hidden="true" className="text-base leading-none w-5 text-center">
                    {cmd.glyph}
                  </span>
                  <span className="flex-1 text-sm truncate">{cmd.label}</span>
                  {cmd.hint && <span className="text-xs text-muted shrink-0">{cmd.hint}</span>}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
