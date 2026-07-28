# Humanization Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blended "reads human" percentage with explicit voice-rule and Humanize finding states, release BlogForge 0.8.3, and deploy the merged change to home-services.

**Architecture:** Introduce a small `HumanizationCheck` presentation component driven by explicit pending, unavailable, and complete states. `HumanizePanel` will preserve raw lint counts instead of converting them into a score, while Checkup will remove blended-score fields and report Humanize availability and counts through its existing rows.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Biome, pnpm, Python/pytest deployment-script tests, GitHub pull requests, launchd host deployment.

## Global Constraints

- Do not display a blended "reads human" percentage in Humanize or Checkup.
- Do not substitute placeholder scores when lint or Humanize is pending or unavailable.
- Preserve Light, Medium, and Strong intensity behavior, Humanize caching, stale-result notices, and the detailed apply/accept workflow.
- Keep the Humanize API `score` field for compatibility; stop using it as a user-facing measurement.
- Release exactly version `0.8.3`.
- Preserve the untracked `.pnpm-store/` directory.
- Deploy only the reviewed commit merged into `origin/main`.

---

### Task 1: Humanization Check state model and presentation

**Files:**
- Create: `packages/web/src/components/draft/HumanizationCheck.tsx`
- Create: `packages/web/tests/components/HumanizationCheck.test.tsx`
- Delete after migration: `packages/web/src/components/draft/HumannessPulse.tsx`
- Delete after migration: `packages/web/tests/components/HumannessPulse.test.tsx`

**Interfaces:**
- Produces:

```ts
export type HumanizationCheckState =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "complete"; count: number };

export interface HumanizationCheckProps {
  voiceRules: HumanizationCheckState;
  humanize: HumanizationCheckState;
  lensCount: number;
}

export function HumanizationCheck(props: HumanizationCheckProps): JSX.Element;
```

- Summary precedence:
  1. either unavailable -> `Check incomplete`
  2. either pending -> `Checking humanization…`
  3. voice count greater than zero -> `Voice rules need attention`
  4. Humanize count greater than zero -> `Review Humanize suggestions`
  5. otherwise -> `Looks natural`

- Row copy:

```ts
function voiceDetail(state: HumanizationCheckState): string {
  if (state.status === "pending") return "Checking voice rules…";
  if (state.status === "unavailable") return "Voice-rule check unavailable";
  return state.count === 0
    ? "No voice-rule issues"
    : `${state.count} open ${state.count === 1 ? "finding" : "findings"}`;
}

function humanizeDetail(state: HumanizationCheckState, lensCount: number): string {
  if (state.status === "pending") return `Analyzing ${lensCount} lenses…`;
  if (state.status === "unavailable") return "Humanize review unavailable";
  return state.count === 0
    ? `No suggestions across ${lensCount} lenses`
    : `${state.count} ${state.count === 1 ? "suggestion" : "suggestions"} across ${lensCount} lenses`;
}
```

- [ ] **Step 1: Write failing component tests**

Cover complete clean results, deterministic findings, advisory-only findings,
pending results, unavailable results, singular/plural copy, and the absence of
`reads human` and percentage copy.

```tsx
render(
  <HumanizationCheck
    voiceRules={{ status: "complete", count: 2 }}
    humanize={{ status: "complete", count: 3 }}
    lensCount={3}
  />,
);
expect(screen.getByText("Voice rules need attention")).toBeInTheDocument();
expect(screen.getByText("2 open findings")).toBeInTheDocument();
expect(screen.getByText("3 suggestions across 3 lenses")).toBeInTheDocument();
expect(screen.queryByText(/reads human/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd packages/web
pnpm exec vitest run tests/components/HumanizationCheck.test.tsx
```

Expected: FAIL because `HumanizationCheck.tsx` does not exist.

- [ ] **Step 3: Implement the minimal component**

Render a compact card headed `Humanization Check`, a derived summary label, and
the two rows. Use semantic green, amber, coral, and muted dots already present
in the draft-review UI. Do not render an SVG waveform, progress bar, numeric
score, or percentage.

- [ ] **Step 4: Run the focused test and targeted formatting**

Run:

```bash
cd packages/web
pnpm exec vitest run tests/components/HumanizationCheck.test.tsx
pnpm exec biome check src/components/draft/HumanizationCheck.tsx tests/components/HumanizationCheck.test.tsx
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the component**

```bash
git add packages/web/src/components/draft/HumanizationCheck.tsx packages/web/tests/components/HumanizationCheck.test.tsx
git commit -m "feat: add transparent humanization check"
```

---

### Task 2: Migrate the Humanize panel from scores to check states

**Files:**
- Modify: `packages/web/src/components/draft/HumanizePanel.tsx`
- Modify: `packages/web/src/components/draft/HumanizeReviewRail.tsx`
- Modify: `packages/web/tests/components/HumanizePanel.test.tsx`
- Modify: `packages/web/tests/components/HumanizeReviewRail.test.tsx`

**Interfaces:**
- Consumes `HumanizationCheck` and `HumanizationCheckState` from Task 1.
- `voiceRules` count equals `lint.violations.length + lint.repetitions.length`.
- Lens counts before a report exists are:

```ts
const LENS_COUNTS: Record<Intensity, number> = {
  light: 2,
  medium: 3,
  strong: 4,
};
```

- The completed Humanize count is the sum of `report.lenses[*].findings.length`.

- [ ] **Step 1: Replace the old readout test with failing state-based tests**

Mock `lintDraft` explicitly. Assert that:

- a clean lint result and empty Medium report show `Looks natural`,
  `No voice-rule issues`, and `No suggestions across 3 lenses`;
- lint findings show the exact open count;
- Humanize findings show the exact suggestion count;
- a rejected Humanize request shows `Check incomplete` and
  `Humanize review unavailable`;
- a rejected lint request shows `Voice-rule check unavailable`;
- `reads human` is absent.

- [ ] **Step 2: Run the focused tests and verify failures**

Run:

```bash
cd packages/web
pnpm exec vitest run tests/components/HumanizePanel.test.tsx tests/components/HumanizeReviewRail.test.tsx
```

Expected: the new assertions FAIL against the score-based UI.

- [ ] **Step 3: Store explicit lint state and derive Humanize state**

Replace `antiRobot: number | null` with:

```ts
const [voiceRules, setVoiceRules] = useState<HumanizationCheckState>({
  status: "pending",
});
```

On lint fulfillment, set a complete count. On rejection, set unavailable. Do
not silently swallow the error or substitute `88`.

Derive the Humanize state with error precedence:

```ts
const humanizeState: HumanizationCheckState = error
  ? { status: "unavailable" }
  : loading
    ? { status: "pending" }
    : report
      ? { status: "complete", count: countHumanizeFindings(report) }
      : { status: "pending" };
```

Replace `HumannessPulse` with `HumanizationCheck`. Keep the existing detailed
error banner so the actionable HTTP/provider error remains visible.

- [ ] **Step 4: Remove authorship-like empty-state copy**

Change the detailed rail empty state from:

```text
No robotic tells found — this already reads human.
```

to:

```text
No Humanize suggestions found for these lenses.
```

- [ ] **Step 5: Run focused tests and targeted formatting**

Run:

```bash
cd packages/web
pnpm exec vitest run tests/components/HumanizationCheck.test.tsx tests/components/HumanizePanel.test.tsx tests/components/HumanizeReviewRail.test.tsx
pnpm exec biome check src/components/draft/HumanizationCheck.tsx src/components/draft/HumanizePanel.tsx src/components/draft/HumanizeReviewRail.tsx tests/components/HumanizationCheck.test.tsx tests/components/HumanizePanel.test.tsx tests/components/HumanizeReviewRail.test.tsx
```

Expected: all focused tests and targeted checks PASS.

- [ ] **Step 6: Commit the Humanize migration**

```bash
git add packages/web/src/components/draft/HumanizePanel.tsx packages/web/src/components/draft/HumanizeReviewRail.tsx packages/web/tests/components/HumanizePanel.test.tsx packages/web/tests/components/HumanizeReviewRail.test.tsx
git commit -m "fix: replace Humanize score with check results"
```

---

### Task 3: Remove blended humanness from Checkup

**Files:**
- Modify: `packages/web/src/lib/checkup.ts`
- Modify: `packages/web/src/components/draft/CheckupPanel.tsx`
- Modify: `packages/web/tests/lib/checkup.test.ts`
- Delete: `packages/web/src/components/draft/HumannessPulse.tsx`
- Delete: `packages/web/tests/components/HumannessPulse.test.tsx`

**Interfaces:**
- `CheckupSummary` no longer exposes `humanity`, `antiRobot`, or `humanSignal`.
- `summarizeCheckup` continues to receive the same four nullable raw results.
- A `null` Humanize result after Checkup settles produces:

```ts
{
  key: "humanize",
  label: "Humanization",
  count: 0,
  detail: "Humanize review unavailable",
  severity: "warn",
}
```

- A completed report produces exact count copy:

```text
0 suggestions across 3 lenses
3 suggestions across 2 lenses
```

- [ ] **Step 1: Rewrite failing Checkup unit tests**

Delete tests for `humanityScore` and `blendHumanness`. Assert:

- the summary type/result has no score fields;
- exact Humanize count and lens count are reported;
- `null` Humanize is unavailable, not "Not scored yet";
- existing headline prioritization and `totalOpen` behavior remain intact.

- [ ] **Step 2: Run the Checkup tests and verify failure**

Run:

```bash
cd packages/web
pnpm exec vitest run tests/lib/checkup.test.ts
```

Expected: FAIL while the blended fields and copy still exist.

- [ ] **Step 3: Simplify Checkup data and UI**

Remove the score functions and fields from `checkup.ts`. Update the Humanize
row to use counts and availability. Remove the `HumannessPulse` import and
header rendering from `CheckupPanel`; preserve the existing headline, stale
notice, exact rows, and `<N> to address` copy.

- [ ] **Step 4: Delete the obsolete pulse**

Delete `HumannessPulse.tsx` and `HumannessPulse.test.tsx`, then verify no
production or test import remains:

```bash
rg -n "HumannessPulse|blendHumanness|reads human" packages/web/src packages/web/tests
```

Expected: no Humanize or Checkup score references. The scoped Proofreader
phrase may remain only in `LintPanel.tsx`.

- [ ] **Step 5: Run focused tests and targeted formatting**

Run:

```bash
cd packages/web
pnpm exec vitest run tests/lib/checkup.test.ts tests/components/HumanizationCheck.test.tsx tests/components/HumanizePanel.test.tsx tests/components/HumanizeReviewRail.test.tsx
pnpm exec biome check src/lib/checkup.ts src/components/draft/CheckupPanel.tsx src/components/draft/HumanizationCheck.tsx src/components/draft/HumanizePanel.tsx src/components/draft/HumanizeReviewRail.tsx tests/lib/checkup.test.ts tests/components/HumanizationCheck.test.tsx tests/components/HumanizePanel.test.tsx tests/components/HumanizeReviewRail.test.tsx
```

Expected: all focused tests and targeted checks PASS.

- [ ] **Step 6: Commit the Checkup migration**

```bash
git add packages/web/src/lib/checkup.ts packages/web/src/components/draft/CheckupPanel.tsx packages/web/src/components/draft/HumannessPulse.tsx packages/web/tests/lib/checkup.test.ts packages/web/tests/components/HumannessPulse.test.tsx
git commit -m "fix: remove blended humanness score"
```

---

### Task 4: Release 0.8.3 and verify the branch

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/api/blogforge/__init__.py`
- Modify: `CHANGELOG.md`

**Interfaces:**
- `scripts/version.sh` must report `0.8.3`.
- `/api/health` must report `0.8.3` after deployment.

- [ ] **Step 1: Set the synchronized version**

Run:

```bash
scripts/version.sh 0.8.3
```

Expected: both version files change from `0.8.2` to `0.8.3`.

- [ ] **Step 2: Add the changelog entry**

At the top of `CHANGELOG.md`, add:

```markdown
## 0.8.3 — 2026-07-28

- Replace the misleading blended “reads human” percentage with a transparent
  Humanization Check that reports voice-rule findings and Humanize suggestions
  separately, including honest pending and unavailable states.
```

- [ ] **Step 3: Run milestone verification**

Run:

```bash
cd packages/web
pnpm test
pnpm build
pnpm exec biome check src/lib/checkup.ts src/components/draft/CheckupPanel.tsx src/components/draft/HumanizationCheck.tsx src/components/draft/HumanizePanel.tsx src/components/draft/HumanizeReviewRail.tsx tests/lib/checkup.test.ts tests/components/HumanizationCheck.test.tsx tests/components/HumanizePanel.test.tsx tests/components/HumanizeReviewRail.test.tsx
cd ../..
uv run pytest packages/api/tests/test_home_deploy_scripts.py -q
scripts/version.sh check
git diff --check
```

Expected: the full web suite, build, targeted Biome checks, deployment-script
tests, version check, and whitespace check PASS. Record any unrelated
full-package Biome baseline separately rather than modifying unrelated files.

- [ ] **Step 4: Commit the release**

```bash
git add CHANGELOG.md packages/web/package.json packages/api/blogforge/__init__.py
git commit -m "chore: release humanization check"
```

---

### Task 5: Review, integrate, clean up, and deploy

**Files:**
- No additional source files.

**Interfaces:**
- Feature branch: `codex/humanization-check`
- Release version: `0.8.3`
- Deploy command: `scripts/deploy-home.sh`
- SSH alias: `blogforge-home`
- Public health URL: `https://blogforge.baskettecase.com/api/health`

- [ ] **Step 1: Run final verification and inspect the branch**

Run the Task 4 verification commands again only if subsequent review fixes
changed production or test code. Then run:

```bash
git status --short --branch
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only `.pnpm-store/` is untracked, no unstaged tracked changes remain,
and the feature commits are visible.

- [ ] **Step 2: Push and open the pull request**

```bash
git push -u origin codex/humanization-check
```

Create a ready PR titled:

```text
fix: replace humanness score with transparent checks
```

The PR body must include the UI behavior, version `0.8.3`, verification
results, and any unrelated CI baseline failures.

- [ ] **Step 3: Review and merge**

Confirm the PR diff matches the approved spec. Merge with squash-and-merge
after assessing required checks. Record the PR URL and merge commit.

- [ ] **Step 4: Return the primary checkout to merged main**

```bash
git fetch origin main
git switch main
git merge --ff-only origin/main
git branch -D codex/humanization-check
git push origin --delete codex/humanization-check
```

Expected: `HEAD`, `main`, and `origin/main` identify the PR merge commit. The
untracked `.pnpm-store/` remains untouched.

- [ ] **Step 5: Deploy and verify home-services**

Run:

```bash
scripts/deploy-home.sh
```

Expected output includes:

```text
✓ version: 0.8.3
✓ internal health: {"status":"ok","version":"0.8.3",...}
✓ public health: {"status":"ok","version":"0.8.3",...}
```

If deployment fails, inspect only the documented service state and logs:

```bash
ssh blogforge-home 'launchctl print gui/$(id -u)/com.baskettecase.blogforge'
ssh blogforge-home 'tail -n 200 ~/.blogforge/serve.log'
```

- [ ] **Step 6: Final state check**

```bash
git status --short --branch
git log -1 --oneline --decorate
curl -fsS https://blogforge.baskettecase.com/api/health
```

Expected: synchronized clean `main` except preserved `.pnpm-store/`, the merged
PR commit at HEAD, and public health reporting `0.8.3`.
