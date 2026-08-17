import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ApiError } from "../../src/api/client";
import { expandSections, getDraft, updateDraft } from "../../src/api/drafts";
import { DraftPage } from "../../src/routes/DraftPage";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

vi.mock("../../src/hooks/useMe", () => ({
  useMe: () => ({
    user: { id: "u1", email: "test@x.com", role: "user", status: "approved" },
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));
vi.mock("../../src/api/auth", () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  getMe: vi.fn().mockResolvedValue({
    id: "u1",
    email: "test@x.com",
    role: "user",
    status: "approved",
  }),
}));

vi.mock("../../src/api/drafts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/drafts")>();
  return {
    ...actual,
    getDraft: vi.fn().mockResolvedValue({
      id: "abc123",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      title: "My Test Draft",
      stage: "research",
      idea: {
        topic: "My Test Draft",
        pack_slug: "dan",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        target_words: 1500,
      },
      outline: null,
      sections: [],
    }),
    updateDraft: vi.fn().mockImplementation((_, d) => Promise.resolve(d)),
    getActiveJob: vi.fn().mockResolvedValue({ job_id: null }),
    expandSections: vi.fn().mockResolvedValue({ job_id: "job-1" }),
  };
});

// Keep ResearchPanel's network calls deterministic.
vi.mock("../../src/api/ideation", () => ({
  listIdeation: vi.fn().mockResolvedValue([]),
  postIdeationMessage: vi.fn(),
  acceptIdeation: vi.fn(),
}));

vi.mock("../../src/api/references", () => ({
  listReferences: vi.fn().mockResolvedValue([]),
  deleteReference: vi.fn(),
  addUrlReference: vi.fn(),
  addTextReference: vi.fn(),
  addFileReference: vi.fn(),
}));

vi.mock("../../src/api/packs", () => ({
  listPacks: vi.fn().mockResolvedValue([]),
  getManifest: vi.fn().mockResolvedValue({ formats: [] }),
  listFormats: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/api/providers", () => ({
  listProviderAvailability: vi.fn().mockResolvedValue({ anthropic: false }),
  listModels: vi.fn().mockResolvedValue([]),
}));

describe("DraftPage", () => {
  it("offers Retry after a load failure and opens the draft without exposing raw details", async () => {
    const failure = Object.assign(new Error('HTTP 503: {"upstream":"offline"}'), {
      status: 503,
      detail: { upstream: "offline" },
    }) as ApiError;
    vi.mocked(getDraft).mockRejectedValueOnce(failure);

    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The service is unavailable");
    const details = screen.getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("HTTP 503");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText(/All drafts/i)).toBeInTheDocument();
    expect(getDraft).toHaveBeenCalledTimes(2);
  });

  it("offers Sign in for an expired session without navigating automatically", async () => {
    vi.mocked(getDraft).mockRejectedValueOnce(
      Object.assign(new Error("session_revoked"), {
        status: 401,
        code: "session_revoked",
        detail: "session_revoked",
      }) as ApiError,
    );

    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(window.location.pathname).not.toBe("/login");
  });

  it("keeps edited workspace content after a failed save and retries the same draft", async () => {
    vi.mocked(getDraft).mockResolvedValueOnce({
      id: "abc123",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      title: "Saved locally",
      stage: "outline",
      idea: {
        topic: "Saved locally",
        pack_slug: "dan",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        target_words: 1500,
      },
      outline: {
        opening_hook: "Original opening",
        sections: [{ id: "s1", title: "First", brief: "A brief" }],
        estimated_words: 1500,
      },
      sections: [],
      tags: [],
      hero_image_key: null,
    });
    vi.mocked(updateDraft).mockRejectedValueOnce(
      Object.assign(new Error("raw database response"), { status: 503 }) as ApiError,
    );

    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const opening = await screen.findByLabelText("Opening hook");
    fireEvent.change(opening, { target: { value: "My unsaved opening" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The service is unavailable");
    expect(opening).toHaveValue("My unsaved opening");
    const details = screen.getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("raw database response");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateDraft).mock.calls[1]?.[1].outline?.opening_hook).toBe(
      "My unsaved opening",
    );
  });

  it("ignores an older save failure after a newer save succeeds", async () => {
    vi.mocked(updateDraft).mockReset();
    const firstSave = deferred<unknown>();
    const secondSave = deferred<unknown>();
    vi.mocked(getDraft).mockResolvedValueOnce({
      id: "abc123",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      title: "Race test",
      stage: "outline",
      idea: { topic: "Race test", pack_slug: "dan", provider: "anthropic", model: "m" },
      outline: {
        opening_hook: "Original",
        sections: [{ id: "s1", title: "First", brief: "Brief" }],
        estimated_words: 500,
      },
      sections: [],
      tags: [],
      hero_image_key: null,
    });
    vi.mocked(updateDraft)
      .mockImplementationOnce(() => firstSave.promise as Promise<never>)
      .mockImplementationOnce(() => secondSave.promise as Promise<never>);

    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const opening = await screen.findByLabelText("Opening hook");
    fireEvent.change(opening, { target: { value: "Older edit" } });
    fireEvent.change(opening, { target: { value: "Newest edit" } });
    expect(updateDraft).toHaveBeenCalledTimes(2);

    await act(async () => secondSave.resolve(undefined));
    await waitFor(() => expect(screen.getByText(/All changes saved/i)).toBeInTheDocument());
    await act(async () =>
      firstSave.reject(Object.assign(new Error("stale failure"), { status: 503 })),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(opening).toHaveValue("Newest edit");
  });

  it("retries the exact snapshot from the latest failed save", async () => {
    vi.mocked(updateDraft).mockReset();
    vi.mocked(getDraft).mockResolvedValueOnce({
      id: "abc123",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      title: "Snapshot test",
      stage: "outline",
      idea: { topic: "Snapshot test", pack_slug: "dan", provider: "anthropic", model: "m" },
      outline: {
        opening_hook: "Original",
        sections: [{ id: "s1", title: "First", brief: "Brief" }],
        estimated_words: 500,
      },
      sections: [],
      tags: [],
      hero_image_key: null,
    });
    vi.mocked(updateDraft)
      .mockRejectedValueOnce(Object.assign(new Error("latest failure"), { status: 503 }))
      .mockResolvedValueOnce(undefined as never);

    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("Opening hook"), {
      target: { value: "Failed snapshot" },
    });
    await screen.findByRole("alert");
    const failedPayload = structuredClone(vi.mocked(updateDraft).mock.calls[0]?.[1]);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateDraft).mock.calls[1]?.[1]).toEqual(failedPayload);
  });

  it("renders the ResearchPanel once a draft loads at the research stage", async () => {
    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Send$/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Accept this outline/i })).toBeDisabled();
  });

  it("shows the back-to-drafts link and saved status", async () => {
    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/All drafts/i)).toBeInTheDocument());
    expect(screen.getByText(/All changes saved/i)).toBeInTheDocument();
  });

  it("requests remaining-only expansion when retrying a failed draft", async () => {
    vi.mocked(getDraft).mockResolvedValueOnce({
      id: "abc123",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      title: "Interrupted draft",
      stage: "sections",
      idea: {
        topic: "Interrupted draft",
        pack_slug: "dan",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        target_words: 1500,
      },
      outline: {
        opening_hook: "A hook",
        sections: [
          { id: "s1", title: "Completed", brief: "Keep it" },
          { id: "s2", title: "Remaining", brief: "Finish it" },
        ],
        estimated_words: 1500,
      },
      sections: [
        {
          id: "s1",
          title: "Completed",
          brief: "Keep it",
          content_md: "Completed prose remains visible.",
          status: "ready",
          last_generated_at: null,
          last_error: null,
          word_count: 4,
        },
        {
          id: "s2",
          title: "Remaining",
          brief: "Finish it",
          content_md: "",
          status: "failed",
          last_generated_at: null,
          last_error: "Interrupted",
          word_count: 0,
        },
      ],
      tags: [],
      hero_image_key: null,
    });

    render(
      <MemoryRouter initialEntries={["/drafts/abc123"]}>
        <Routes>
          <Route path="/drafts/:id" element={<DraftPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const retryButton = await screen.findByRole("button", { name: "Retry remaining sections" });
    fireEvent.click(retryButton);

    await waitFor(() =>
      expect(expandSections).toHaveBeenCalledWith("abc123", { remainingOnly: true }),
    );
  });
});
