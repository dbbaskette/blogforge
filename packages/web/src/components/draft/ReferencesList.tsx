import { useCallback, useEffect, useState } from "react";

import { promoteToLibrary } from "../../api/library";
import { type Reference, deleteReference, listReferences } from "../../api/references";
import { AddReferenceForm } from "./AddReferenceForm";
import { ReferenceLibraryPicker } from "./ReferenceLibraryPicker";

interface ReferencesListProps {
  draftId: string;
  /** Optional collapsible chrome (used in outline/sections stage). */
  collapsible?: boolean;
  /** When `collapsible`, control the initial open state. */
  defaultOpen?: boolean;
}

function kindGlyph(kind: Reference["kind"]): string {
  if (kind === "url") return "🔗";
  if (kind === "file") return "📄";
  return "✏︎";
}

function fmtChars(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k chars`;
  return `${n} chars`;
}

export function ReferencesList({
  draftId,
  collapsible = false,
  defaultOpen = true,
}: ReferencesListProps): JSX.Element {
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [savedLibId, setSavedLibId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const next = await listReferences(draftId);
      setRefs(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draftId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRemove = useCallback(
    async (refId: string): Promise<void> => {
      try {
        await deleteReference(draftId, refId);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [draftId, reload],
  );

  const handleAdded = useCallback((ref: Reference) => {
    setRefs((cur) => (cur ? [...cur, ref] : [ref]));
  }, []);

  const handleSaveToLibrary = useCallback(
    async (refId: string): Promise<void> => {
      try {
        await promoteToLibrary(draftId, refId);
        setSavedLibId(refId);
        setTimeout(() => setSavedLibId((cur) => (cur === refId ? null : cur)), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [draftId],
  );

  const list = refs ?? [];
  const count = list.length;

  const body = (
    <>
      {error && (
        <p
          className="text-xs px-3 py-2 rounded-nb-sm mb-3"
          style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
        >
          {error}
        </p>
      )}

      {refs === null ? (
        <p className="text-xs text-muted italic">Loading references…</p>
      ) : count === 0 ? (
        <p className="text-xs text-muted italic">
          No references yet. Add a URL, paste some text, or upload a file.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-3">
          {list.map((r) => (
            <li
              key={r.id}
              className="flex items-baseline gap-2 group/ref text-sm"
              data-testid="reference-item"
            >
              <span aria-hidden className="text-base leading-none">
                {kindGlyph(r.kind)}
              </span>
              <span className="flex-1 min-w-0 truncate text-ink" title={r.name}>
                {r.name}
              </span>
              <span className="font-mono text-[11px] text-muted-2 shrink-0">
                {fmtChars(r.extracted_chars)}
              </span>
              <button
                type="button"
                onClick={() => void handleSaveToLibrary(r.id)}
                aria-label={`Save reference ${r.name} to library`}
                className="opacity-0 group-hover/ref:opacity-100 focus:opacity-100 transition-opacity text-[11px] text-muted hover:text-cobalt-600 px-1 shrink-0"
              >
                {savedLibId === r.id ? "✓ saved" : "save"}
              </button>
              <button
                type="button"
                onClick={() => void handleRemove(r.id)}
                aria-label={`Remove reference ${r.name}`}
                className="opacity-0 group-hover/ref:opacity-100 focus:opacity-100 transition-opacity text-xs text-muted hover:text-rose px-1"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddReferenceForm draftId={draftId} onAdded={handleAdded} />
      <ReferenceLibraryPicker
        draftId={draftId}
        attachedNames={new Set(list.map((r) => r.name))}
        onAdded={handleAdded}
      />
    </>
  );

  if (collapsible) {
    return (
      <section className="nb-card p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
          aria-expanded={open}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            References{" "}
            <span className="font-mono text-muted-2">({String(count).padStart(2, "0")})</span>
          </span>
          <span aria-hidden className="text-muted">
            {open ? "−" : "+"}
          </span>
        </button>
        {open && <div className="mt-3">{body}</div>}
      </section>
    );
  }

  return (
    <section className="nb-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
        References{" "}
        <span className="font-mono text-muted-2">({String(count).padStart(2, "0")})</span>
      </h3>
      {body}
    </section>
  );
}
