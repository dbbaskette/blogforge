import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as publishing from "../../src/api/publishing";
import { GitHubPublishingCard } from "../../src/components/settings/GitHubPublishingCard";

const savedSettings: publishing.PublishingSettings = {
  configured: true,
  owner: "dbbaskette",
  repo: "blog-content",
  branch: "main",
  content_dir: "content/posts",
  frontmatter_preset: "hugo",
  token_set: true,
  validated_login: null,
  ready: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("GitHubPublishingCard", () => {
  it("loads the saved destination without ever rendering the token", async () => {
    vi.spyOn(publishing, "getPublishingSettings").mockResolvedValue(savedSettings);
    render(<GitHubPublishingCard />);

    expect(await screen.findByDisplayValue("dbbaskette")).toBeInTheDocument();
    expect(screen.getByDisplayValue("blog-content")).toBeInTheDocument();
    expect(screen.getByDisplayValue("content/posts")).toBeInTheDocument();
    const token = screen.getByLabelText("GitHub publishing token");
    expect(token).toHaveAttribute("type", "password");
    expect(token).toHaveValue("");
    expect(screen.getByText("Token saved ✓")).toBeInTheDocument();
  });

  it("saves token then destination, validates, and clears token input", async () => {
    vi.spyOn(publishing, "getPublishingSettings").mockResolvedValue({
      ...savedSettings,
      token_set: false,
    });
    const saveToken = vi
      .spyOn(publishing, "savePublishingToken")
      .mockResolvedValue({ token_set: true, login: "octocat" });
    const saveSettings = vi
      .spyOn(publishing, "savePublishingSettings")
      .mockResolvedValue({ ...savedSettings, token_set: true });
    const validate = vi.spyOn(publishing, "validatePublishingSettings").mockResolvedValue({
      ready: true,
      validated_login: "octocat",
      private: true,
    });
    render(<GitHubPublishingCard />);

    const token = await screen.findByLabelText("GitHub publishing token");
    fireEvent.change(token, { target: { value: "github_pat_secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));

    await waitFor(() => expect(validate).toHaveBeenCalledTimes(1));
    expect(saveToken).toHaveBeenCalledWith("github_pat_secret");
    expect(saveSettings).toHaveBeenCalledWith({
      owner: "dbbaskette",
      repo: "blog-content",
      branch: "main",
      content_dir: "content/posts",
      frontmatter_preset: "hugo",
    });
    expect(saveToken.mock.invocationCallOrder[0]).toBeLessThan(
      saveSettings.mock.invocationCallOrder[0],
    );
    expect(saveSettings.mock.invocationCallOrder[0]).toBeLessThan(
      validate.mock.invocationCallOrder[0],
    );
    expect(token).toHaveValue("");
    expect(await screen.findByText("Ready as octocat ✓")).toBeInTheDocument();
    expect(screen.getByText("Private repository access confirmed.")).toBeInTheDocument();
  });

  it("clears only the token and preserves destination fields", async () => {
    vi.spyOn(publishing, "getPublishingSettings").mockResolvedValue(savedSettings);
    const clear = vi.spyOn(publishing, "clearPublishingToken").mockResolvedValue(undefined);
    render(<GitHubPublishingCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Clear token" }));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(screen.getByDisplayValue("dbbaskette")).toBeInTheDocument();
    expect(screen.getByDisplayValue("blog-content")).toBeInTheDocument();
    expect(screen.getByText("Token not set")).toBeInTheDocument();
  });

  it("uses old local settings only as defaults when no server record exists", async () => {
    localStorage.setItem(
      "bf.publish.config",
      JSON.stringify({
        owner: "local-owner",
        repo: "local-repo",
        branch: "drafts",
        dir: "posts",
        preset: "jekyll",
      }),
    );
    vi.spyOn(publishing, "getPublishingSettings").mockResolvedValue({
      configured: false,
      owner: "",
      repo: "",
      branch: "main",
      content_dir: "content/posts",
      frontmatter_preset: "hugo",
      token_set: false,
      validated_login: null,
      ready: false,
    });
    render(<GitHubPublishingCard />);

    expect(await screen.findByDisplayValue("local-owner")).toBeInTheDocument();
    expect(screen.getByDisplayValue("local-repo")).toBeInTheDocument();
    expect(screen.getByDisplayValue("drafts")).toBeInTheDocument();
    expect(screen.getByDisplayValue("posts")).toBeInTheDocument();
    expect(screen.getByDisplayValue("jekyll")).toBeInTheDocument();
  });

  it("shows the precise API validation error", async () => {
    vi.spyOn(publishing, "getPublishingSettings").mockResolvedValue(savedSettings);
    vi.spyOn(publishing, "savePublishingSettings").mockResolvedValue(savedSettings);
    vi.spyOn(publishing, "validatePublishingSettings").mockRejectedValue(
      Object.assign(new Error("Branch 'release' was not found."), {
        status: 404,
        code: "github_branch_not_found",
      }),
    );
    render(<GitHubPublishingCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Save and test" }));
    expect(await screen.findByText("Branch 'release' was not found.")).toBeInTheDocument();
  });
});
