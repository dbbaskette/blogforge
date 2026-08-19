import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/api/drafts", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/drafts")>("../../src/api/drafts");
  return { ...actual, lintDraft: vi.fn(), checkClaims: vi.fn() };
});
vi.mock("../../src/api/geo", async () => {
  const actual = await vi.importActual<typeof import("../../src/api/geo")>("../../src/api/geo");
  return { ...actual, analyzeGeo: vi.fn() };
});
vi.mock("../../src/api/suggest", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/suggest")>("../../src/api/suggest");
  return { ...actual, suggestImprovements: vi.fn() };
});
vi.mock("../../src/api/humanize", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/humanize")>("../../src/api/humanize");
  return { ...actual, analyzeHumanize: vi.fn() };
});
vi.mock("../../src/api/references", () => ({ listReferences: vi.fn() }));

import { type Draft, checkClaims, lintDraft } from "../../src/api/drafts";
import { analyzeGeo } from "../../src/api/geo";
import { analyzeHumanize } from "../../src/api/humanize";
import { listReferences } from "../../src/api/references";
import { suggestImprovements } from "../../src/api/suggest";
import { ReviewCenter } from "../../src/components/draft/ReviewCenter";
import {
  combineAnalysisHash,
  hashDraftContent,
  hashReferenceFingerprint,
  peekCached,
  setCached,
} from "../../src/lib/panelCache";
import { type ReviewSummary, summarizeReview } from "../../src/lib/reviewCenter";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const draft: Draft = {
  id: "d1",
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
  title: "Review this draft",
  stage: "sections",
  idea: { topic: "Review", pack_slug: "dan", provider: "anthropic", model: "model" },
  outline: { opening_hook: "Opening", sections: [], estimated_words: 500 },
  sections: [
    {
      id: "s1",
      title: "First",
      brief: "Explain it",
      content_md: "Draft content",
      status: "ready",
      last_generated_at: null,
      word_count: 2,
    },
  ],
  tags: [],
  hero_image_key: null,
};

const lintResult = {
  violations: [
    {
      id: "v1",
      kind: "violation" as const,
      section_id: "s1",
      start: 0,
      end: 5,
      match: "Draft",
      rule: "voice",
      message: "Tighten this.",
    },
  ],
  repetitions: [],
  hits: [],
};

const factsResult = {
  has_references: true,
  claims: [{ text: "Claim", status: "supported" as const, note: "Supported." }],
};

const geoResult = {
  score: 80,
  grade: "B",
  levers: [
    {
      key: "answer_first",
      label: "Answer first",
      score: 80,
      detail: "Lead directly.",
      findings: [{ section_id: "s1", note: "The answer is buried." }],
      fix: null,
    },
  ],
};

const shapeResult = {
  reword: [{ target: "Draft", note: "Be direct.", options: ["Direct"] }],
};

const humanizeResult = {
  intensity: "medium" as const,
  score: 90,
  lenses: [{ key: "flow", label: "Flow", findings: [] }],
};

const reference = {
  id: "r1",
  kind: "url" as const,
  name: "Primary source",
  url: "https://example.com/source",
  original_filename: null,
  extracted_chars: 1200,
  added_at: "2026-08-17T10:00:00Z",
};

function props() {
  return {
    draft,
    onOpenProofread: vi.fn(),
    onOpenFactualSupport: vi.fn(),
    onOpenShape: vi.fn(),
    onOpenHumanization: vi.fn(),
    onOpenGeo: vi.fn(),
    onOpenHeadlines: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("ReviewCenter", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(lintDraft).mockResolvedValue(lintResult);
    vi.mocked(checkClaims).mockResolvedValue(factsResult);
    vi.mocked(analyzeGeo).mockResolvedValue(geoResult);
    vi.mocked(suggestImprovements).mockResolvedValue(shapeResult);
    vi.mocked(analyzeHumanize).mockResolvedValue(humanizeResult);
    vi.mocked(listReferences).mockResolvedValue([reference]);
  });

  it("short-circuits factual support when the reference count is zero", async () => {
    vi.mocked(listReferences).mockResolvedValue([]);
    vi.mocked(checkClaims).mockRejectedValue(
      Object.assign(new Error("provider unavailable"), { code: "provider_rate_limit" }),
    );

    render(<ReviewCenter {...props()} />);

    const factual = await screen.findByRole("region", { name: "Factual support review" });
    expect(within(factual).getByText("Unavailable")).toBeInTheDocument();
    expect(within(factual).getByText(/attach references/i)).toBeInTheDocument();
    expect(checkClaims).not.toHaveBeenCalled();
  });

  it("runs every check, keeps a failed row visible, and opens successful tools", async () => {
    vi.mocked(analyzeHumanize).mockRejectedValue(new Error("provider rejected request"));
    const callbacks = props();

    render(<ReviewCenter {...callbacks} />);

    await waitFor(() => expect(lintDraft).toHaveBeenCalledWith("d1"));
    expect(checkClaims).toHaveBeenCalledWith("d1");
    expect(analyzeGeo).toHaveBeenCalledWith("d1");
    expect(suggestImprovements).toHaveBeenCalledWith("d1");
    expect(analyzeHumanize).toHaveBeenCalledWith("d1", "medium");

    const failed = await screen.findByRole("region", { name: "Humanization review" });
    expect(within(failed).getByText("Failed")).toBeInTheDocument();
    expect(within(failed).getByText("Something went wrong")).toBeInTheDocument();

    const proofread = screen.getByRole("region", { name: "Proofread review" });
    expect(within(proofread).getByText("Current")).toBeInTheDocument();
    fireEvent.click(within(proofread).getByRole("button", { name: "Open Proofread" }));
    expect(callbacks.onOpenProofread).toHaveBeenCalledWith("s1");

    fireEvent.click(screen.getByRole("button", { name: "Explore headlines and hooks" }));
    expect(callbacks.onOpenHeadlines).toHaveBeenCalled();
  });

  it("retries only failed checks while preserving successful rows", async () => {
    vi.mocked(analyzeHumanize)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(humanizeResult);

    render(<ReviewCenter {...props()} />);

    await screen.findByRole("button", { name: "Retry failed checks" });
    fireEvent.click(screen.getByRole("button", { name: "Retry failed checks" }));

    await waitFor(() => expect(analyzeHumanize).toHaveBeenCalledTimes(2));
    expect(lintDraft).toHaveBeenCalledTimes(1);
    expect(checkClaims).toHaveBeenCalledTimes(1);
    expect(analyzeGeo).toHaveBeenCalledTimes(1);
    expect(suggestImprovements).toHaveBeenCalledTimes(1);
    expect(
      within(screen.getByRole("region", { name: "Proofread review" })).getByText("Current"),
    ).toBeInTheDocument();
  });

  it("bypasses every analysis cache when the writer explicitly re-runs", async () => {
    render(<ReviewCenter {...props()} />);

    await screen.findByRole("button", { name: "Re-run" });
    fireEvent.click(screen.getByRole("button", { name: "Re-run" }));

    await waitFor(() => expect(lintDraft).toHaveBeenCalledTimes(2));
    expect(checkClaims).toHaveBeenCalledTimes(2);
    expect(analyzeGeo).toHaveBeenCalledTimes(2);
    expect(suggestImprovements).toHaveBeenCalledTimes(2);
    expect(analyzeHumanize).toHaveBeenCalledTimes(2);
  });

  it("restores a compatible cached review and marks completed rows stale after edits", async () => {
    const cached = summarizeReview({
      proofread: { status: "current", data: lintResult },
      factualSupport: { status: "current", data: factsResult },
      shape: { status: "current", data: shapeResult },
      humanization: { status: "current", data: humanizeResult },
      geo: { status: "current", data: geoResult },
    });
    setCached("review-center", draft.id, "older-content", cached);

    render(<ReviewCenter {...props()} />);

    expect(await screen.findAllByText("Stale")).toHaveLength(5);
    expect(screen.getByText(/draft changed since this review/i)).toBeInTheDocument();
    expect(lintDraft).not.toHaveBeenCalled();
    expect(checkClaims).not.toHaveBeenCalled();
    expect(analyzeGeo).not.toHaveBeenCalled();
    expect(suggestImprovements).not.toHaveBeenCalled();
    expect(analyzeHumanize).not.toHaveBeenCalled();
    expect(hashDraftContent(draft)).not.toBe("older-content");
  });

  it("includes the current reference fingerprint when restoring a combined review", async () => {
    const cached = summarizeReview({
      proofread: { status: "current", data: lintResult },
      factualSupport: {
        status: "current",
        data: { has_references: false, claims: [] },
      },
      shape: { status: "current", data: shapeResult },
      humanization: { status: "current", data: humanizeResult },
      geo: { status: "current", data: geoResult },
    });
    const noReferences = hashReferenceFingerprint([]);
    setCached(
      "review-center",
      draft.id,
      combineAnalysisHash(hashDraftContent(draft), noReferences),
      cached,
    );

    vi.mocked(listReferences).mockResolvedValueOnce([]);
    const view = render(<ReviewCenter {...props()} />);
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(listReferences).toHaveBeenCalledWith("d1");

    view.unmount();
    vi.mocked(listReferences).mockResolvedValue([
      {
        id: "r1",
        kind: "url",
        name: "New source",
        url: "https://example.com/source",
        original_filename: null,
        extracted_chars: 1200,
        added_at: "2026-08-17T10:00:00Z",
      },
    ]);

    render(<ReviewCenter {...props()} />);

    const factual = await screen.findByRole("region", { name: "Factual support review" });
    const geo = screen.getByRole("region", { name: "GEO readiness review" });
    expect(within(factual).getByText("Stale")).toBeInTheDocument();
    expect(within(geo).getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText(/draft changed since this review/i)).toBeInTheDocument();
  });

  it("joins concurrent StrictMode runs instead of duplicating analyzer requests", async () => {
    render(
      <StrictMode>
        <ReviewCenter {...props()} />
      </StrictMode>,
    );

    await screen.findByRole("button", { name: "Re-run" });
    expect(lintDraft).toHaveBeenCalledTimes(1);
    expect(checkClaims).toHaveBeenCalledTimes(1);
    expect(analyzeGeo).toHaveBeenCalledTimes(1);
    expect(suggestImprovements).toHaveBeenCalledTimes(1);
    expect(analyzeHumanize).toHaveBeenCalledTimes(1);
  });

  it("keeps a fast new identity when a slow old review finishes later", async () => {
    const oldReferences = deferred<(typeof reference)[]>();
    vi.mocked(listReferences)
      .mockImplementationOnce(() => oldReferences.promise)
      .mockResolvedValueOnce([reference]);
    vi.mocked(lintDraft).mockResolvedValueOnce({ violations: [], repetitions: [], hits: [] });
    const editedDraft: Draft = {
      ...structuredClone(draft),
      outline: {
        opening_hook: "A newly edited opening",
        sections: [],
        estimated_words: 500,
      },
      sections: [{ ...draft.sections[0], content_md: "Fast new content" }],
    };
    const view = render(<ReviewCenter {...props()} />);

    view.rerender(<ReviewCenter {...props()} draft={editedDraft} />);
    const proofread = await screen.findByRole("region", { name: "Proofread review" });
    expect(await within(proofread).findByText("No voice-rule issues")).toBeInTheDocument();

    await act(async () => oldReferences.resolve([reference]));
    await waitFor(() => expect(listReferences).toHaveBeenCalledTimes(2));

    expect(within(proofread).getByText("No voice-rule issues")).toBeInTheDocument();
    expect(within(proofread).queryByText("1 voice-rule issue")).not.toBeInTheDocument();
    expect(within(proofread).getByText("Current")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    const cached = peekCached<ReviewSummary>("review-center", draft.id);
    expect(cached?.hash).toBe(
      combineAnalysisHash(hashDraftContent(editedDraft), hashReferenceFingerprint([reference])),
    );
  });
});
