import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Draft, OutlineProposal } from "../../api/drafts";
import {
  type IdeationMessage,
  acceptIdeation,
  listIdeation,
  postIdeationMessage,
} from "../../api/ideation";
import { type StreamJobHandlers, useStreamJob } from "../../hooks/useStreamJob";
import { ReferencesList } from "./ReferencesList";

interface ResearchPanelProps {
  draft: Draft;
  /** Called after Accept succeeds so the parent can refetch the draft. */
  onJobComplete: () => void;
}

interface LiveMessage {
  /** Server id if persisted, else "live". */
  id: string;
  role: "user" | "assistant";
  content: string;
  proposed_outline: OutlineProposal | null;
}

function fromServer(m: IdeationMessage): LiveMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    proposed_outline: m.proposed_outline,
  };
}

export function ResearchPanel({ draft, onJobComplete }: ResearchPanelProps): JSX.Element {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const hist = await listIdeation(draft.id);
      setMessages(hist.map(fromServer));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // SSE handlers: token deltas append to the live assistant bubble;
  // on done we reload history so the server-side parsed proposed_outline
  // shows up correctly and the message gets its persisted id.
  const liveAssistantText = useRef("");
  const handlersRef = useRef<StreamJobHandlers>({});
  handlersRef.current = useMemo<StreamJobHandlers>(
    () => ({
      onDelta: (delta) => {
        liveAssistantText.current += delta;
        const text = liveAssistantText.current;
        setMessages((cur) => {
          const idx = cur.findIndex((m) => m.id === "__live__");
          if (idx === -1) {
            return [
              ...cur,
              { id: "__live__", role: "assistant", content: text, proposed_outline: null },
            ];
          }
          const next = [...cur];
          next[idx] = { ...next[idx], content: text };
          return next;
        });
      },
      onError: (err) => {
        setError(err.message);
        setStreaming(false);
        setJobId(null);
        liveAssistantText.current = "";
      },
      onDone: () => {
        setStreaming(false);
        setJobId(null);
        liveAssistantText.current = "";
        void reload();
      },
    }),
    [reload],
  );
  const stableHandlers = useMemo<StreamJobHandlers>(
    () => ({
      onDelta: (d) => handlersRef.current.onDelta?.(d),
      onResult: (r) => handlersRef.current.onResult?.(r),
      onError: (e) => handlersRef.current.onError?.(e),
      onDone: () => handlersRef.current.onDone?.(),
    }),
    [],
  );
  useStreamJob(jobId, stableHandlers);

  const handleSend = useCallback(async (): Promise<void> => {
    const text = composer.trim();
    if (!text || streaming) return;
    setError(null);
    setComposer("");
    // Optimistically append the user bubble immediately.
    setMessages((cur) => [
      ...cur,
      { id: `__pending__-${cur.length}`, role: "user", content: text, proposed_outline: null },
    ]);
    setStreaming(true);
    try {
      const { job_id } = await postIdeationMessage(draft.id, text);
      setJobId(job_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreaming(false);
      // Roll back: refetch from server so optimistic state is replaced with truth.
      void reload();
    }
  }, [composer, draft.id, reload, streaming]);

  const handleAccept = useCallback(async (): Promise<void> => {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await acceptIdeation(draft.id);
      onJobComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccepting(false);
    }
  }, [accepting, draft.id, onJobComplete]);

  // Find the most recent assistant message with a proposed_outline.
  const latestOutline = useMemo<OutlineProposal | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.proposed_outline) return m.proposed_outline;
    }
    return null;
  }, [messages]);

  return (
    <section className="space-y-4 animate-fade-up">
      <header className="nb-card p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
          Step 1 · Research
        </p>
        <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">
          Talk it through.
        </h2>
        <p className="text-sm text-muted mt-1.5 leading-relaxed">
          Add references on the right, chat to refine the angle, then accept the outline that feels
          right.
        </p>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        {/* LEFT — chat */}
        <div className="nb-card p-5 flex flex-col min-h-[420px]">
          <ol className="flex-1 space-y-3 mb-4 overflow-y-auto" aria-label="Ideation transcript">
            {messages.length === 0 && (
              <li className="text-sm text-muted italic">
                Start by describing what you want to write. BlogForge will propose an outline once
                it has enough to work with.
              </li>
            )}
            {messages.map((m) => (
              <li
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-nb-sm px-3 py-2 text-sm bg-cobalt-600 text-white"
                    : "mr-auto max-w-[85%] rounded-nb-sm px-3 py-2 text-sm bg-canvas border border-rule text-ink-2 whitespace-pre-wrap"
                }
                data-role={m.role}
              >
                {m.content}
              </li>
            ))}
          </ol>

          {error && (
            <p
              className="text-xs px-3 py-2 rounded-nb-sm mb-2"
              style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
            >
              {error}
            </p>
          )}

          <div className="border-t border-rule pt-3">
            <label htmlFor="ideation-composer" className="sr-only">
              Message BlogForge
            </label>
            <textarea
              id="ideation-composer"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Describe your angle, or ask for an outline…"
              rows={2}
              className="nb-textarea text-sm"
              aria-label="Message BlogForge"
              disabled={streaming}
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={streaming || !composer.trim()}
                className="nb-btn nb-btn-sm nb-btn-primary"
              >
                {streaming ? "Streaming…" : "Send"}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT — outline preview + references */}
        <div className="space-y-4">
          <section className="nb-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Proposed outline
            </h3>
            {latestOutline ? (
              <div className="space-y-3 text-sm">
                <p className="font-serif italic text-ink-2">{latestOutline.opening_hook}</p>
                <ol className="space-y-1.5 border-l border-rule pl-3">
                  {latestOutline.sections.map((s, i) => (
                    <li key={s.id} className="text-ink-2">
                      <span className="font-mono text-[11px] text-muted-2 mr-2">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-medium">{s.title}</span>
                      {s.brief && (
                        <p className="text-xs text-muted italic pl-7 mt-0.5">{s.brief}</p>
                      )}
                    </li>
                  ))}
                </ol>
                {latestOutline.estimated_words > 0 && (
                  <p className="text-[11px] font-mono text-muted-2">
                    est. {latestOutline.estimated_words.toLocaleString()} words
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted italic">
                Once BlogForge proposes one, it'll appear here.
              </p>
            )}
            <div className="mt-3 pt-3 border-t border-rule flex justify-end">
              <button
                type="button"
                onClick={() => void handleAccept()}
                disabled={!latestOutline || accepting || streaming}
                className="nb-btn nb-btn-sm nb-btn-primary"
              >
                {accepting ? "Accepting…" : "Accept this outline →"}
              </button>
            </div>
          </section>

          <ReferencesList draftId={draft.id} />
        </div>
      </div>
    </section>
  );
}
