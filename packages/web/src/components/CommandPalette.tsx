import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { type DraftSummary, listDrafts } from "../api/drafts";
import { useDialogA11y } from "./ui/useDialogA11y";

interface Command {
  /** Stable key for React + listbox option ids. */
  key: string;
  /** Leading glyph rendered decoratively (aria-hidden). */
  glyph: string;
  label: string;
  hint?: string;
  /** Navigation target; running the command navigates here + closes. */
  to: string;
}

const STATIC_COMMANDS: Command[] = [
  { key: "new", glyph: "✍", label: "New piece", hint: "Compose", to: "/compose" },
  { key: "drafts", glyph: "📝", label: "Your drafts", hint: "Home", to: "/" },
  { key: "voice", glyph: "🎙", label: "Your Voice", to: "/voice" },
  { key: "settings", glyph: "⚙", label: "Settings", to: "/settings" },
  { key: "trash", glyph: "🗑", label: "Trash", to: "/trash" },
];

/** Max dynamic "Open: …" entries shown after filtering. */
const MAX_DRAFTS = 8;

export function CommandPalette({ onClose }: { onClose: () => void }): JSX.Element {
  const ref = useDialogA11y(true, onClose);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

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
    return [...STATIC_COMMANDS, ...draftCommands];
  }, [drafts]);

  const results = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? commands.filter((c) => c.label.toLowerCase().includes(q))
      : commands;
    // Cap only the dynamic draft entries; static commands always remain.
    const staticHits = filtered.filter((c) => !c.key.startsWith("draft-"));
    const draftHits = filtered.filter((c) => c.key.startsWith("draft-")).slice(0, MAX_DRAFTS);
    return [...staticHits, ...draftHits];
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
    navigate(cmd.to);
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
