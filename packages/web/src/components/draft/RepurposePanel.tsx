import { useEffect, useState } from "react";

import { type RepurposeFormat, listRepurposeFormats, repurposeDraft } from "../../api/drafts";
import { useElapsed } from "../../hooks/useElapsed";
import { Icon } from "../ui/Icon";
import { useDialogA11y } from "../ui/useDialogA11y";

interface RepurposePanelProps {
  draftId: string;
  onClose: () => void;
}

/** One repurposed result, keyed by format id. */
interface AtomizedResult {
  text?: string;
  error?: string;
}

type CardKind = "tweet" | "linkedin" | "email" | "default";

/** Pick a platform style from the format's id/label (case-insensitive contains). */
function kindFor(format: RepurposeFormat): CardKind {
  const hay = `${format.id} ${format.label}`.toLowerCase();
  if (/(twitter|thread|tweet|\bx\b)/.test(hay)) return "tweet";
  if (hay.includes("linkedin")) return "linkedin";
  if (hay.includes("news") || hay.includes("email")) return "email";
  return "default";
}

/** Small copy button with transient "Copied!" feedback, shared by every card. */
function CopyButton({
  text,
  copied,
  onCopy,
}: {
  text: string;
  copied: boolean;
  onCopy: (text: string) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onCopy(text)}
      className="nb-btn nb-btn-sm shrink-0"
      aria-label="Copy to clipboard"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function AvatarDot({ className = "" }: { className?: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${className}`}
    >
      You
    </span>
  );
}

/** X / Twitter — tweet-style card with avatar, handle, and a muted action row. */
function TweetCard({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: (text: string) => void;
}): JSX.Element {
  return (
    <article className="nb-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AvatarDot className="bg-ink" />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-ink">Your Name</p>
            <p className="text-xs text-muted">@you</p>
          </div>
        </div>
        <CopyButton text={text} copied={copied} onCopy={onCopy} />
      </div>
      <p className="mt-3 whitespace-pre-wrap font-sans text-[15px] leading-7 text-ink-2">{text}</p>
      <div className="mt-3 flex items-center gap-6 border-t border-rule pt-3 text-xs text-muted">
        <span aria-hidden>💬 Reply</span>
        <span aria-hidden>🔁 Repost</span>
        <span aria-hidden>♡ Like</span>
        <span className="ml-auto text-muted-2">{label}</span>
      </div>
    </article>
  );
}

/** LinkedIn — post-style card with name, "• 1st", and a muted reactions row. */
function LinkedInCard({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: (text: string) => void;
}): JSX.Element {
  return (
    <article className="nb-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AvatarDot className="bg-cobalt-600" />
          <div className="leading-tight">
            <p className="text-sm font-semibold text-ink">
              Your Name <span className="font-normal text-muted">• 1st</span>
            </p>
            <p className="text-xs text-muted">Founder · Posting on LinkedIn</p>
          </div>
        </div>
        <CopyButton text={text} copied={copied} onCopy={onCopy} />
      </div>
      <p className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-2">
        {text}
      </p>
      <div className="mt-3 flex items-center gap-2 border-t border-rule pt-3 text-xs text-muted">
        <span
          aria-hidden
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-cobalt-600 text-[9px] text-white"
        >
          👍
        </span>
        <span aria-hidden>Like</span>
        <span aria-hidden className="ml-3">
          💬 Comment
        </span>
        <span aria-hidden className="ml-3">
          ↪ Repost
        </span>
        <span className="ml-auto text-muted-2">{label}</span>
      </div>
    </article>
  );
}

/** Newsletter / email — an inbox-ish card with a subject-line treatment. */
function EmailCard({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: (text: string) => void;
}): JSX.Element {
  // First non-empty line reads naturally as the subject; rest is the body.
  const lines = text.split("\n");
  const subjectIdx = lines.findIndex((l) => l.trim().length > 0);
  const subject = subjectIdx >= 0 ? lines[subjectIdx].trim() : label;
  const body =
    subjectIdx >= 0
      ? lines
          .slice(subjectIdx + 1)
          .join("\n")
          .trimStart()
      : "";

  return (
    <article className="nb-card overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-canvas px-4 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <CopyButton text={text} copied={copied} onCopy={onCopy} />
      </div>
      <div className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-2">Subject</p>
        <p className="font-serif text-lg font-medium leading-snug text-ink">{subject}</p>
        {body && (
          <p className="mt-2 whitespace-pre-wrap border-t border-rule pt-3 font-sans text-sm leading-relaxed text-ink-2">
            {body}
          </p>
        )}
      </div>
    </article>
  );
}

/** Default — a clean labeled card for TL;DR, SEO meta, anything unmatched. */
function DefaultCard({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: (text: string) => void;
}): JSX.Element {
  return (
    <article className="nb-card p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</h4>
        <CopyButton text={text} copied={copied} onCopy={onCopy} />
      </div>
      <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-2">{text}</p>
    </article>
  );
}

/** Route a format + its text to the right platform-styled card. */
function PreviewCard({
  format,
  text,
  copied,
  onCopy,
}: {
  format: RepurposeFormat;
  text: string;
  copied: boolean;
  onCopy: (text: string) => void;
}): JSX.Element {
  const common = { label: format.label, text, copied, onCopy };
  switch (kindFor(format)) {
    case "tweet":
      return <TweetCard {...common} />;
    case "linkedin":
      return <LinkedInCard {...common} />;
    case "email":
      return <EmailCard {...common} />;
    default:
      return <DefaultCard {...common} />;
  }
}

export function RepurposePanel({ draftId, onClose }: RepurposePanelProps): JSX.Element {
  const [formats, setFormats] = useState<RepurposeFormat[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Atomize-all state: when set, the panel shows every format's card.
  const [atomizing, setAtomizing] = useState(false);
  const [atomized, setAtomized] = useState<Record<string, AtomizedResult> | null>(null);
  const secs = useElapsed(loading || atomizing);

  useEffect(() => {
    listRepurposeFormats()
      .then(setFormats)
      .catch((e: Error) => setError(e.message));
  }, []);

  const run = async (formatId: string): Promise<void> => {
    setActive(formatId);
    setAtomized(null);
    setLoading(true);
    setError(null);
    setResult("");
    setCopiedId(null);
    try {
      const { text } = await repurposeDraft(draftId, formatId);
      setResult(text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const atomizeAll = async (): Promise<void> => {
    if (formats.length === 0) return;
    setActive(null);
    setResult("");
    setError(null);
    setCopiedId(null);
    setAtomized(null);
    setAtomizing(true);
    try {
      const settled = await Promise.allSettled(formats.map((f) => repurposeDraft(draftId, f.id)));
      const next: Record<string, AtomizedResult> = {};
      formats.forEach((f, i) => {
        const r = settled[i];
        next[f.id] =
          r.status === "fulfilled"
            ? { text: r.value.text }
            : { error: (r.reason as Error).message };
      });
      setAtomized(next);
    } finally {
      setAtomizing(false);
    }
  };

  const copy = async (text: string, id: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
  };

  const panelRef = useDialogA11y(true, onClose);
  const busy = loading || atomizing;
  const activeFormat = formats.find((f) => f.id === active);
  const successCount = atomized ? Object.values(atomized).filter((r) => r.text != null).length : 0;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-ink/30 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="w-[480px] max-w-full bg-canvas border-l border-rule-2 h-full overflow-y-auto shadow-nb-pop m-0 p-0 text-ink animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
        aria-label="Repurpose draft"
      >
        <header className="px-6 pt-6 pb-4 border-b border-rule bg-white sticky top-0 z-10">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600">
              Repurpose
            </p>
            <button type="button" onClick={onClose} className="nb-icon-btn" aria-label="Close">
              <Icon name="x" size={16} title="" />
            </button>
          </div>
          <h2 className="font-serif text-2xl font-medium text-ink tracking-tight mt-1">
            One post, every channel
          </h2>
          <p className="text-sm text-muted mt-1">
            Spin this draft into another format — in your voice.
          </p>
        </header>

        <div className="p-6 space-y-5">
          <button
            type="button"
            onClick={atomizeAll}
            disabled={busy || formats.length === 0}
            className="nb-btn nb-btn-primary w-full justify-center"
          >
            ✨ Atomize all{formats.length > 0 ? ` (${formats.length})` : ""}
          </button>

          <div className="flex flex-wrap gap-2">
            {formats.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => run(f.id)}
                disabled={busy}
                aria-pressed={active === f.id}
                className={`nb-btn nb-btn-sm ${active === f.id ? "nb-btn-primary" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error && (
            <div
              className="px-3 py-2 rounded-nb-sm text-sm"
              style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
            >
              {error}
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-3 py-12 justify-center text-amber">
              <span
                aria-hidden
                className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
              />
              <span className="text-sm font-medium">
                {atomizing
                  ? `Spinning up ${formats.length} formats… ${secs}s`
                  : `Repurposing… ${secs}s`}
              </span>
            </div>
          )}

          {/* Atomize-all view: a stacked column of every platform card. */}
          {!busy && atomized && (
            <section className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Every channel
                </h3>
                <span className="text-xs text-muted-2">
                  {successCount}/{formats.length} ready
                </span>
              </div>
              {formats.map((f) => {
                const r = atomized[f.id];
                if (r?.error) {
                  return (
                    <div
                      key={f.id}
                      className="px-3 py-2 rounded-nb-sm text-sm"
                      style={{
                        background: "#fde7e2",
                        border: "1px solid #f7c3b6",
                        color: "#b5321b",
                      }}
                    >
                      <strong className="font-semibold">{f.label}:</strong> {r.error}
                    </div>
                  );
                }
                if (r?.text == null) return null;
                return (
                  <PreviewCard
                    key={f.id}
                    format={f}
                    text={r.text}
                    copied={copiedId === f.id}
                    onCopy={(t) => copy(t, f.id)}
                  />
                );
              })}
            </section>
          )}

          {/* Single-format view. */}
          {!busy && !atomized && result && activeFormat && (
            <section className="animate-fade-in">
              <PreviewCard
                format={activeFormat}
                text={result}
                copied={copiedId === activeFormat.id}
                onCopy={(t) => copy(t, activeFormat.id)}
              />
            </section>
          )}

          {!busy && !atomized && !result && !error && (
            <p className="text-sm text-muted italic font-serif py-8 text-center">
              Atomize all — or pick one format to generate.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
