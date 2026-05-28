import { useState } from "react";

import type { ApiError } from "../../api/client";
import { downloadDraftUrl } from "../../api/drafts";
import { type LinkedInStats, getLinkedInStats, publishToLinkedIn } from "../../api/linkedin";

/** LinkedIn feed posts are capped at 3000 characters (by Unicode code point). */
const LINKEDIN_CHAR_LIMIT = 3000;

interface WorkspaceFooterProps {
  draftId: string;
  totalWords: number;
  draftedCount: number;
  sectionCount: number;
  onLint: () => void;
  /** Assembled markdown used as the LinkedIn post body. */
  postText: string;
  /** First-section text used by the "post opening as teaser" escape hatch. */
  teaserText: string;
  /** Draft workflow stage; the Post button only shows on "sections". */
  stage: "research" | "outline" | "sections";
}

/** Friendly inline copy for the publish error codes the connector returns. */
function publishErrorMessage(err: unknown): string {
  const code = (err as ApiError)?.code ?? "";
  if (code.includes("not_connected")) {
    return "Connect your LinkedIn account in Settings before posting.";
  }
  if (code.includes("linkedin_reconnect_required")) {
    return "Your LinkedIn connection expired — reconnect in Settings.";
  }
  if (code.includes("content_too_long")) {
    return "That post is over LinkedIn's 3000-character limit.";
  }
  return err instanceof Error ? err.message : "Couldn't publish to LinkedIn.";
}

export function WorkspaceFooter({
  draftId,
  totalWords,
  draftedCount,
  sectionCount,
  onLint,
  postText,
  teaserText,
  stage,
}: WorkspaceFooterProps): JSX.Element {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  // LinkedIn composer state.
  const [composerOpen, setComposerOpen] = useState(false);
  const [text, setText] = useState(postText);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [postId, setPostId] = useState<string | null>(null);
  const [stats, setStats] = useState<LinkedInStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const charCount = [...text].length;
  const overBy = charCount - LINKEDIN_CHAR_LIMIT;
  const overLimit = overBy > 0;

  const handleCopy = async (): Promise<void> => {
    try {
      const res = await fetch(downloadDraftUrl(draftId), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const md = await res.text();
      await navigator.clipboard.writeText(md);
      setCopyMessage("Copied!");
    } catch {
      setCopyMessage("Copy failed");
    }
    setTimeout(() => setCopyMessage(null), 2000);
  };

  const openComposer = (): void => {
    setText(postText);
    setPublishError(null);
    setComposerOpen(true);
  };

  const useTeaser = (): void => {
    // Trim to the first section, or hard-truncate to the limit as a last resort.
    const trimmed = teaserText.trim();
    setText(
      [...trimmed].length > LINKEDIN_CHAR_LIMIT
        ? [...trimmed].slice(0, LINKEDIN_CHAR_LIMIT).join("")
        : trimmed,
    );
  };

  const handlePublish = async (): Promise<void> => {
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await publishToLinkedIn({ text, draft_id: draftId });
      setPostId(result.post_id);
      setComposerOpen(false);
    } catch (err) {
      setPublishError(publishErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const refreshStats = async (): Promise<void> => {
    if (!postId) return;
    setRefreshing(true);
    try {
      setStats(await getLinkedInStats(postId));
    } catch {
      /* leave the last-known stats in place */
    } finally {
      setRefreshing(false);
    }
  };

  const showPostButton = stage === "sections";

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none w-full max-w-3xl px-4">
      {composerOpen && (
        <div className="nb-card shadow-nb-pop p-4 mb-2 pointer-events-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-serif text-base font-medium text-ink">Post to LinkedIn</h3>
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              className="nb-btn nb-btn-ghost nb-btn-sm"
            >
              Close
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full text-sm font-sans p-3 rounded-nb border border-rule bg-white focus:outline-none focus:ring-2 focus:ring-cobalt-300 resize-y"
            aria-label="LinkedIn post text"
          />
          <div className="flex items-center justify-between mt-2 gap-3">
            <span
              className={`font-mono text-xs ${overLimit ? "text-rose-ink font-semibold" : "text-muted"}`}
            >
              {charCount}/{LINKEDIN_CHAR_LIMIT}
              {overLimit && <span className="ml-2">({overBy} over)</span>}
            </span>
            <div className="flex items-center gap-2">
              {overLimit && (
                <button type="button" onClick={useTeaser} className="nb-btn nb-btn-sm">
                  Post opening as teaser
                </button>
              )}
              <button
                type="button"
                onClick={handlePublish}
                disabled={overLimit || publishing || charCount === 0}
                className="nb-btn nb-btn-primary nb-btn-sm"
              >
                {publishing ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>
          {publishError && <p className="text-xs text-rose-ink mt-2">{publishError}</p>}
        </div>
      )}

      <footer className="nb-card shadow-nb-pop px-4 py-2.5 flex items-center gap-4 pointer-events-auto">
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="font-mono text-ink font-medium text-[13px]">
            {totalWords.toLocaleString()}
          </span>
          <span>words</span>
          <span className="text-muted-2">·</span>
          <span>
            <span className="font-mono text-ink">
              {draftedCount}/{sectionCount}
            </span>{" "}
            drafted
          </span>
        </div>
        <div className="flex-1" />

        {postId && (
          <span className="inline-flex items-center gap-2 text-xs text-leaf font-medium">
            Posted to LinkedIn ✓
            {stats && (
              <span className="text-muted">
                👍{stats.likes} · 💬{stats.comments}
              </span>
            )}
            <button
              type="button"
              onClick={refreshStats}
              disabled={refreshing}
              className="nb-btn nb-btn-ghost nb-btn-sm"
            >
              {refreshing ? "…" : "Refresh"}
            </button>
          </span>
        )}

        <button type="button" onClick={handleCopy} className="nb-btn nb-btn-sm">
          {copyMessage ?? "Copy markdown"}
        </button>
        <a href={downloadDraftUrl(draftId)} download className="nb-btn nb-btn-sm no-underline">
          Download .md
        </a>
        <button type="button" onClick={onLint} className="nb-btn nb-btn-sm">
          Lint
        </button>
        {showPostButton && !postId && (
          <button type="button" onClick={openComposer} className="nb-btn nb-btn-primary nb-btn-sm">
            Post to LinkedIn
          </button>
        )}
      </footer>
    </div>
  );
}
