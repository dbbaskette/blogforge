import { useState } from "react";

import {
  type Reference,
  addFileReference,
  addTextReference,
  addUrlReference,
} from "../../api/references";

interface AddReferenceFormProps {
  draftId: string;
  onAdded: (ref: Reference) => void;
}

type Mode = "url" | "text" | "file";

export function AddReferenceForm({ draftId, onAdded }: AddReferenceFormProps): JSX.Element {
  const [mode, setMode] = useState<Mode>("url");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL fields
  const [url, setUrl] = useState("");
  const [urlName, setUrlName] = useState("");

  // Text fields
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");

  // File fields
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");

  const resetAll = (): void => {
    setUrl("");
    setUrlName("");
    setTextName("");
    setTextContent("");
    setFile(null);
    setFileName("");
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      let added: Reference;
      if (mode === "url") {
        if (!url.trim()) throw new Error("URL is required");
        added = await addUrlReference(draftId, url.trim(), urlName.trim() || undefined);
      } else if (mode === "text") {
        if (!textName.trim()) throw new Error("A name is required");
        if (!textContent.trim()) throw new Error("Content is required");
        added = await addTextReference(draftId, textName.trim(), textContent);
      } else {
        if (!file) throw new Error("Choose a file");
        added = await addFileReference(draftId, file, fileName.trim() || undefined);
      }
      onAdded(added);
      resetAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const tabClass = (m: Mode): string =>
    m === mode ? "nb-btn nb-btn-sm nb-btn-primary" : "nb-btn nb-btn-sm nb-btn-ghost";

  return (
    <div className="border-t border-rule pt-3">
      <div role="tablist" aria-label="Add reference" className="flex gap-1.5 mb-3">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "url"}
          onClick={() => setMode("url")}
          className={tabClass("url")}
        >
          URL
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "text"}
          onClick={() => setMode("text")}
          className={tabClass("text")}
        >
          Text
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "file"}
          onClick={() => setMode("file")}
          className={tabClass("file")}
        >
          File
        </button>
      </div>

      {mode === "url" && (
        <div className="space-y-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="nb-input text-sm"
            aria-label="Reference URL"
          />
          <input
            type="text"
            value={urlName}
            onChange={(e) => setUrlName(e.target.value)}
            placeholder="Friendly name (optional)"
            className="nb-input text-sm"
            aria-label="Friendly name"
          />
        </div>
      )}

      {mode === "text" && (
        <div className="space-y-2">
          <input
            type="text"
            value={textName}
            onChange={(e) => setTextName(e.target.value)}
            placeholder="Name for this snippet"
            className="nb-input text-sm"
            aria-label="Text name"
          />
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="Paste content here…"
            rows={4}
            className="nb-textarea text-sm font-serif"
            aria-label="Text content"
          />
        </div>
      )}

      {mode === "file" && (
        <div className="space-y-2">
          <input
            type="file"
            accept=".md,.txt,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            aria-label="Reference file"
          />
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="Friendly name (optional)"
            className="nb-input text-sm"
            aria-label="File friendly name"
          />
        </div>
      )}

      {error && (
        <p
          className="text-xs px-2 py-1.5 rounded-nb-sm mt-2"
          style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="nb-btn nb-btn-sm nb-btn-primary"
        >
          {submitting ? "Adding…" : "Add reference"}
        </button>
      </div>
    </div>
  );
}
