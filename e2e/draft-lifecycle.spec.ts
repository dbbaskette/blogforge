import { expect, test } from "@playwright/test";

test("draft lifecycle: create, generate outline, expand sections, download", async ({ page }) => {
  // Navigate to the drafts list
  await page.goto("/");

  // Open New draft dialog
  await page.getByRole("button", { name: /\+ New draft/ }).click();

  // Fill topic
  await page.getByLabel("Topic").fill("E2E topic test");

  // Pick voice pack
  await page.getByLabel("Voice pack").selectOption("dan");

  // Wait for model dropdown to populate (provider must report available + models must load)
  await page.waitForFunction(
    () => {
      const sel = document.getElementById("nd-model") as HTMLSelectElement | null;
      return sel !== null && sel.options.length > 0 && sel.options[0].value !== "";
    },
    { timeout: 15_000 },
  );

  // Submit
  await page.getByRole("button", { name: /Create draft/ }).click();

  // Should navigate to /drafts/<id>
  await page.waitForURL(/\/drafts\/[a-f0-9]+/, { timeout: 10_000 });

  // Stage 1 is showing — click Generate outline
  await page.getByRole("button", { name: /Generate outline/ }).click();

  // Stage 2: outline section title inputs should appear (titles are in text inputs)
  await expect(page.getByRole("textbox", { name: "Section title" }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("textbox", { name: "Section title" })).toHaveCount(2, {
    timeout: 5_000,
  });

  // Advance to Stage 3 by clicking Expand all sections
  await page.getByRole("button", { name: /Expand all sections/ }).click();

  // Wait for sections to finish generating and content to be visible.
  // onJobComplete reloads the draft → sections get content_md → MarkdownEditor shows text.
  // The content appears inside the Tiptap prose editor.
  await expect(page.locator(".prose >> text=Some section body content").first()).toBeVisible({
    timeout: 30_000,
  });

  // Verify both sections rendered their content
  await expect(page.locator(".prose >> text=Some section body content")).toHaveCount(2, {
    timeout: 10_000,
  });

  // Download .md link must be visible in the sticky footer
  const downloadLink = page.getByRole("link", { name: /Download \.md/i });
  await expect(downloadLink).toBeVisible();
});
