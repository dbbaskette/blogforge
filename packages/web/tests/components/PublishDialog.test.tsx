import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as draftsApi from "../../src/api/drafts";
import type { Draft } from "../../src/api/drafts";
import * as publishingApi from "../../src/api/publishing";
import { PublishDialog } from "../../src/components/draft/PublishDialog";

const draft: Draft = {
  id: "draft-1",
  created_at: "2026-07-17T12:00:00Z",
  updated_at: "2026-07-17T12:00:00Z",
  title: "A private repository post",
  stage: "sections",
  idea: {
    topic: "A private repository post",
    pack_slug: "",
    provider: "codex-cli",
    model: "codex-default",
  },
  outline: null,
  sections: [],
  tags: [],
  hero_image_key: null,
};

const configured: publishingApi.PublishingSettings = {
  configured: true,
  owner: "dbbaskette",
  repo: "blog-content",
  branch: "main",
  content_dir: "content/posts",
  frontmatter_preset: "hugo",
  token_set: true,
  validated_login: null,
  ready: true,
};

function renderDialog(value: Draft = draft): void {
  render(
    <MemoryRouter>
      <PublishDialog draft={value} onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(publishingApi, "getPublishingSettings").mockResolvedValue(configured);
});

describe("PublishDialog", () => {
  it("shows a loading state before settings arrive", () => {
    vi.spyOn(publishingApi, "getPublishingSettings").mockReturnValue(new Promise(() => {}));
    renderDialog();
    expect(screen.getByText("Loading publishing settings…")).toBeInTheDocument();
  });

  it("links to Settings when the destination or token is missing", async () => {
    vi.spyOn(publishingApi, "getPublishingSettings").mockResolvedValue({
      ...configured,
      configured: false,
      token_set: false,
    });
    renderDialog();
    expect(await screen.findByText("GitHub publishing is not configured.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("shows the fixed destination without editable repository controls", async () => {
    renderDialog();
    expect(await screen.findByText("dbbaskette/blog-content")).toBeInTheDocument();
    expect(screen.getByText("main · content/posts")).toBeInTheDocument();
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Repo")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download the one-time GEO site setup guide" }),
    ).toBeInTheDocument();
  });

  it("publishes directly and shows authoritative file and commit links", async () => {
    const publish = vi.spyOn(draftsApi, "publishDraftToGitHub").mockResolvedValue({
      path: "content/posts/a-private-repository-post.md",
      file_url: "https://github.com/dbbaskette/blog-content/blob/main/content/posts/post.md",
      commit_url: "https://github.com/dbbaskette/blog-content/commit/abc",
      commit_sha: "abc",
      content_sha: "blob",
      published_at: "2026-07-17T12:00:00Z",
    });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith("draft-1"));
    expect(await screen.findByText("Published to GitHub ✓")).toBeInTheDocument();
    expect(screen.getByText("content/posts/a-private-repository-post.md")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View published file" })).toHaveAttribute(
      "href",
      "https://github.com/dbbaskette/blog-content/blob/main/content/posts/post.md",
    );
    expect(screen.getByRole("link", { name: "View commit" })).toHaveAttribute(
      "href",
      "https://github.com/dbbaskette/blog-content/commit/abc",
    );
  });

  it.each([
    [
      "publish_path_exists",
      "A file already exists at that path. Change the content folder in Settings or move the existing file.",
    ],
    [
      "publish_conflict",
      "The GitHub file changed since BlogForge last published it. Review the repository copy before retrying.",
    ],
    ["github_rate_limited", "GitHub is rate limiting requests. Wait a moment, then retry."],
  ])("maps %s to an actionable retry message", async (code, expected) => {
    const publish = vi
      .spyOn(draftsApi, "publishDraftToGitHub")
      .mockRejectedValueOnce(
        Object.assign(new Error("raw upstream error"), {
          status: 409,
          code,
          repositoryUrl: "https://github.com/dbbaskette/blog-content",
          path: "content/posts/post.md",
        }),
      )
      .mockResolvedValueOnce({
        path: "content/posts/post.md",
        file_url: "https://github.test/file",
        commit_url: "https://github.test/commit",
        commit_sha: "abc",
        content_sha: "blob",
        published_at: "2026-07-17T12:00:00Z",
      });
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    if (code === "publish_conflict" || code === "publish_path_exists") {
      expect(screen.getByRole("link", { name: "Inspect GitHub file" })).toHaveAttribute(
        "href",
        "https://github.com/dbbaskette/blog-content/blob/main/content/posts/post.md",
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Published to GitHub ✓")).toBeInTheDocument();
  });
});
