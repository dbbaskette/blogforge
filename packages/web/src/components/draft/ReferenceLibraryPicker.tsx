import { useCallback, useEffect, useState } from "react";

import {
  type LibraryReference,
  addReferenceFromLibrary,
  deleteLibraryReference,
  listLibraryReferences,
} from "../../api/library";
import type { Reference } from "../../api/references";

interface ReferenceLibraryPickerProps {
  draftId: string;
  /** Ids already on the draft, so we can hide/disable ones already added. */
  attachedNames: Set<string>;
  onAdded: (ref: Reference) => void;
}

function kindGlyph(kind: LibraryReference["kind"]): string {
  if (kind === "url") return "🔗";
  if (kind === "file") return "📄";
  return "✏︎";
}

export function ReferenceLibraryPicker({
  draftId,
  attachedNames,
  onAdded,
}: ReferenceLibraryPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LibraryReference[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listLibraryReferences());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleAdd = async (lib: LibraryReference): Promise<void> => {
    setBusyId(lib.id);
    setError(null);
    try {
      onAdded(await addReferenceFromLibrary(draftId, lib.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleForget = async (lib: LibraryReference): Promise<void> => {
    setBusyId(lib.id);
    try {
      await deleteLibraryReference(lib.id);
      setItems((cur) => (cur ? cur.filter((x) => x.id !== lib.id) : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-cobalt-600 hover:text-cobalt-700"
        aria-expanded={open}
      >
        {open ? "− Hide library" : "+ Add from library"}
      </button>

      {open && (
        <div className="mt-2 rounded-nb-sm border border-rule bg-canvas/60 p-2 animate-fade-in">
          {error && <p className="text-xs text-rose-ink mb-2">{error}</p>}
          {items === null ? (
            <p className="text-xs text-muted italic py-1">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted italic py-1">
              Your library is empty. Use “Save to library” on a reference to reuse it later.
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((lib) => {
                const already = attachedNames.has(lib.name);
                return (
                  <li key={lib.id} className="flex items-center gap-2 text-sm">
                    <span aria-hidden className="text-base leading-none">
                      {kindGlyph(lib.kind)}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-ink" title={lib.name}>
                      {lib.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleAdd(lib)}
                      disabled={busyId !== null || already}
                      className="nb-btn nb-btn-sm shrink-0"
                    >
                      {already ? "Added" : busyId === lib.id ? "Adding…" : "Add"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleForget(lib)}
                      disabled={busyId !== null}
                      aria-label={`Remove ${lib.name} from library`}
                      className="text-xs text-muted hover:text-rose px-1 shrink-0"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
