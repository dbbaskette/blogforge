import { type ChangeEvent, useRef, useState } from "react";

import {
  addTextSample,
  addUrlSample,
  deleteSample,
  setExemplar,
  uploadSampleFile,
} from "../../api/voice";
import type { VoiceProfile, VoiceSample } from "../../api/voice";
import { useConfirm } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";

interface SamplesListProps {
  profile: VoiceProfile;
  onChange: (updated: VoiceProfile) => void;
  onRefresh: () => Promise<void>;
}

function kindLabel(kind: VoiceSample["kind"]): string {
  switch (kind) {
    case "text":
      return "Text";
    case "url":
      return "URL";
    case "file":
      return "File";
  }
}

function needsRedistill(sample: VoiceSample, distilledAt: string | null): boolean {
  if (!distilledAt) return false;
  return new Date(sample.added_at) > new Date(distilledAt);
}

export function SamplesList({ profile, onChange, onRefresh }: SamplesListProps): JSX.Element {
  const anyNeedsRedistill = profile.samples.some((s) =>
    needsRedistill(s, profile.distilled_at),
  );

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Writing samples</h2>
      <div className="nb-card p-6 space-y-4">
        {anyNeedsRedistill && (
          <div
            className="text-xs px-3 py-2 rounded-nb-sm"
            style={{ background: "#fbf1de", color: "#92600a", border: "1px solid #f3d89b" }}
          >
            Some samples were added after the last distillation — re-distill to include them.
          </div>
        )}

        {profile.samples.length === 0 ? (
          <p className="text-sm text-muted italic font-serif">No samples yet. Add some below.</p>
        ) : (
          <ul className="space-y-2">
            {profile.samples.map((sample) => (
              <SampleRow
                key={sample.id}
                sample={sample}
                distilledAt={profile.distilled_at}
                onToggleExemplar={async () => {
                  const updated = await setExemplar(sample.id, !sample.exemplar);
                  onChange(updated);
                }}
                onDelete={async () => {
                  await deleteSample(sample.id);
                  await onRefresh();
                }}
              />
            ))}
          </ul>
        )}

        <hr className="nb-rule" />

        <AddSampleRow onRefresh={onRefresh} />
      </div>
    </section>
  );
}

interface SampleRowProps {
  sample: VoiceSample;
  distilledAt: string | null;
  onToggleExemplar: () => Promise<void>;
  onDelete: () => Promise<void>;
}

function SampleRow({
  sample,
  distilledAt,
  onToggleExemplar,
  onDelete,
}: SampleRowProps): JSX.Element {
  const confirm = useConfirm();
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isNew = needsRedistill(sample, distilledAt);

  const handleToggle = async (): Promise<void> => {
    setToggling(true);
    try {
      await onToggleExemplar();
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!(await confirm({ title: `Delete sample "${sample.name}"?`, confirmLabel: "Delete", danger: true }))) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li className="flex items-center gap-3 py-2 px-3 rounded-nb-sm hover:bg-card-2 transition-colors">
      <span
        className="text-[10px] font-mono font-semibold uppercase tracking-wider w-8 text-center shrink-0"
        style={{ color: "#6b7280" }}
      >
        {kindLabel(sample.kind)}
      </span>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-ink font-medium truncate block">{sample.name}</span>
        <span className="text-xs text-muted">
          {sample.extracted_chars.toLocaleString()} chars
          {isNew && (
            <span
              className="ml-2 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "#92600a" }}
            >
              · new since distill
            </span>
          )}
        </span>
      </div>
      {sample.status === "failed" && (
        <span className="nb-pill" style={{ background: "#fde7e2", color: "#b5321b" }}>
          failed
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleToggle()}
        disabled={toggling}
        aria-label={sample.exemplar ? "Remove exemplar" : "Mark as exemplar"}
        title={sample.exemplar ? "Remove exemplar" : "Mark as exemplar"}
        className="nb-icon-btn shrink-0"
        style={{ color: sample.exemplar ? "#92600a" : undefined }}
      >
        ★
      </button>
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={deleting}
        aria-label={`Delete sample ${sample.name}`}
        className="nb-icon-btn shrink-0 text-muted hover:text-rose"
      >
        <Icon name="trash" size={14} title="" />
      </button>
    </li>
  );
}

interface AddSampleRowProps {
  onRefresh: () => Promise<void>;
}

type AddMode = "none" | "text" | "url" | "file";

function AddSampleRow({ onRefresh }: AddSampleRowProps): JSX.Element {
  const [mode, setMode] = useState<AddMode>("none");
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = (): void => {
    setMode("none");
    setTextName("");
    setTextContent("");
    setUrlValue("");
    setError(null);
  };

  const handleAddText = async (): Promise<void> => {
    if (!textName.trim() || !textContent.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addTextSample({ name: textName.trim(), text: textContent.trim() });
      await onRefresh();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const handleAddUrl = async (): Promise<void> => {
    const url = urlValue.trim();
    if (!url) return;
    setAdding(true);
    setError(null);
    try {
      await addUrlSample(url);
      await onRefresh();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAdding(true);
    setError(null);
    try {
      await uploadSampleFile(file);
      await onRefresh();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">Add sample</p>

      {mode === "none" && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setMode("text")}
            className="nb-btn nb-btn-sm nb-btn-ghost"
          >
            Paste text
          </button>
          <button
            type="button"
            onClick={() => setMode("url")}
            className="nb-btn nb-btn-sm nb-btn-ghost"
          >
            Add URL
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className="nb-btn nb-btn-sm nb-btn-ghost"
          >
            Upload file
          </button>
        </div>
      )}

      {mode === "text" && (
        <div className="space-y-3">
          <div>
            <label htmlFor="sample-name" className="nb-label">
              Sample name
            </label>
            <input
              id="sample-name"
              type="text"
              value={textName}
              onChange={(e) => setTextName(e.target.value)}
              placeholder="e.g. Blog post intro"
              className="nb-input"
            />
          </div>
          <div>
            <label htmlFor="sample-text" className="nb-label">
              Text content
            </label>
            <textarea
              id="sample-text"
              rows={6}
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="Paste your writing sample here…"
              className="nb-textarea"
            />
          </div>
          {error && (
            <p
              className="text-sm px-3 py-2 rounded-nb-sm"
              style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
            >
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleAddText()}
              disabled={adding || !textName.trim() || !textContent.trim()}
              className="nb-btn nb-btn-primary nb-btn-sm"
            >
              {adding ? "Adding…" : "Add sample"}
            </button>
            <button type="button" onClick={reset} className="nb-btn nb-btn-ghost nb-btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "url" && (
        <div className="space-y-3">
          <div>
            <label htmlFor="sample-url" className="nb-label">
              URL
            </label>
            <input
              id="sample-url"
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder="https://…"
              className="nb-input"
            />
          </div>
          {error && (
            <p
              className="text-sm px-3 py-2 rounded-nb-sm"
              style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
            >
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleAddUrl()}
              disabled={adding || !urlValue.trim()}
              className="nb-btn nb-btn-primary nb-btn-sm"
            >
              {adding ? "Fetching…" : "Add URL"}
            </button>
            <button type="button" onClick={reset} className="nb-btn nb-btn-ghost nb-btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "file" && (
        <div className="space-y-3">
          <div>
            <label htmlFor="sample-file" className="nb-label">
              File (PDF, TXT, MD)
            </label>
            <input
              id="sample-file"
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf"
              onChange={(e) => void handleFileChange(e)}
              disabled={adding}
              className="nb-input"
            />
          </div>
          {adding && (
            <p className="text-sm text-muted">
              <span
                aria-hidden
                className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"
              />
              Uploading…
            </p>
          )}
          {error && (
            <p
              className="text-sm px-3 py-2 rounded-nb-sm"
              style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
            >
              {error}
            </p>
          )}
          <button type="button" onClick={reset} className="nb-btn nb-btn-ghost nb-btn-sm">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
