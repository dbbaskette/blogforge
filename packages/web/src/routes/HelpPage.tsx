import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { type HelpLens, type HelpLever, type HelpRules, getHelpRules } from "../api/help";

// Same hues LensBloom uses for the four rewrite lenses, so the radar and this
// page never disagree about which color means which lens.
const LENS_ACCENT: Record<string, string> = {
  flow: "accent-blue",
  voice: "accent-teal",
  imperfections: "accent-amber",
  soul: "accent-coral",
};

const PIPELINE: { title: string; body: string }[] = [
  {
    title: "1. Prompt-time avoidance",
    body: "The generation prompt is told the banned words, phrases, and patterns up front, so most of it never gets written in the first place.",
  },
  {
    title: "2. Deterministic detection",
    body: "A fast, rule-based linter scans every draft for whatever slipped through — no judgment calls, just matches.",
  },
  {
    title: "3. Model recast",
    body: "Flagged passages go back through a model pass — one of the four lenses below — to rewrite them in the author's own voice.",
  },
  {
    title: "4. Deterministic backstop",
    body: "The same linter runs again on the model's own output, catching anything the recast missed or reintroduced.",
  },
];

const MYTHS: { title: string; body: string }[] = [
  {
    title: "Schema markup",
    body: "Ahrefs ran a controlled test across 1,885 pages and found no citation or ranking uplift from adding schema markup. Google's own guidance says structured data \"isn't required\" for AI features either. BlogForge doesn't score for it.",
  },
  {
    title: "llms.txt",
    body: "SE Ranking studied 300,000 domains and found no correlation between publishing that file and citation rates. Google has said Search doesn't use it. It's not a lever here.",
  },
  {
    title: "Word count",
    body: "Ahrefs found essentially no relationship between length and citations (r ≈ 0.04) — 53% of cited pages ran under 1,000 words. Padding a draft for length buys nothing.",
  },
  {
    title: "Keyword stuffing",
    body: "Repeating the target phrase has been a measurably negative signal since the original Princeton GEO study. If anything, it makes a passage less likely to be cited.",
  },
];

const SOURCES: { label: string; href: string; note: string }[] = [
  {
    label: "Princeton — GEO: Generative Engine Optimization (arXiv 2311.09735)",
    href: "https://arxiv.org/abs/2311.09735",
    note: "The original GEO paper — the baseline this whole model builds on.",
  },
  {
    label: "Google Search Central — Optimizing for Generative AI Features",
    href: "https://developers.google.com/search/docs/appearance/generative-ai-features",
    note: "Google's own guide — confirms query fan-out and says structured data and that file aren't required.",
  },
  {
    label: "Ahrefs — freshness & citation study",
    href: "https://ahrefs.com/blog/",
    note: "17M-citation study behind the freshness and word-count numbers on this page.",
  },
  {
    label: "Kevin Indig — AI citation research",
    href: "https://www.kevin-indig.com/",
    note: "1.2M-response ChatGPT study behind the answer-capsule and front-loading levers.",
  },
  {
    label: "HubSpot — semantic triples experiment",
    href: "https://blog.hubspot.com/",
    note: "+642% citation lift from writing claims as explicit subject–verb–object statements.",
  },
  {
    label: "Wikipedia — Signs of AI writing",
    href: "https://en.wikipedia.org/wiki/Signs_of_AI_writing",
    note: "The community-maintained reference for what reads as machine-written.",
  },
];

/** Weight tiers the GEO levers are grouped into (display order: Core first). */
const TIERS: { label: string; blurb: string; test: (w: number) => boolean }[] = [
  { label: "Core", blurb: "≥ 5% of the score each", test: (w) => w >= 0.05 - 1e-6 },
  { label: "Strong", blurb: "3–4% of the score each", test: (w) => w >= 0.03 - 1e-6 },
  { label: "Refinement", blurb: "≤ 2% of the score each", test: () => true },
];

export function HelpPage(): JSX.Element {
  const [rules, setRules] = useState<HelpRules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    getHelpRules()
      .then(setRules)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Deep-links from the panels land here — scroll to the target section once
  // the live rule data (and therefore the section) has actually rendered.
  useEffect(() => {
    if (!rules || !location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [rules, location.hash]);

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up space-y-14">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">Help</p>
        <h1 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight">
          How BlogForge's rules work
        </h1>
        <p className="mt-2 text-sm text-muted max-w-2xl leading-relaxed">
          Everything below is read live from the rules the tool actually enforces — this page can't
          drift out of sync with what Humanize and Optimize actually do.
        </p>
      </header>

      {error && (
        <div
          className="px-3 py-2 rounded-nb-sm text-sm"
          style={{ background: "#fde7e2", border: "1px solid #f7c3b6", color: "#b5321b" }}
        >
          {error}
        </div>
      )}

      {!rules && !error && (
        <p className="py-16 text-center text-sm text-muted">Loading the rulebook…</p>
      )}

      {rules && (
        <>
          <HumanizeSection data={rules.humanize} />
          <GeoSection levers={rules.geo.levers} />
          <MythsSection />
          <SourcesSection />
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// #humanize

function HumanizeSection({ data }: { data: HelpRules["humanize"] }): JSX.Element {
  const guardrail = data.lenses.find((l) => l.key === "guardrail");
  const lenses = data.lenses.filter((l) => l.key !== "guardrail");

  return (
    <section id="humanize" className="scroll-mt-20">
      <SectionEyebrow label="Humanize" title="Sound human, not scrubbed" />

      <p className="mt-3 text-sm text-ink-2 leading-relaxed max-w-2xl">
        Detectors — and readers — key on <em>structure</em>: sentence-length rhythm, paragraph
        uniformity, templated scaffolding. They key on individual word choice much less. That's why
        the pattern rules below carry more weight here than any banned-word list; a banished word is
        a weak signal on its own, useful mostly as a tie-breaker once the structural tells are gone.
      </p>

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-2">
        {PIPELINE.map((step) => (
          <div key={step.title} className="nb-card p-3">
            <p className="text-xs font-semibold text-cobalt-700">{step.title}</p>
            <p className="mt-1 text-xs text-muted leading-snug">{step.body}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted italic max-w-2xl">
        Em dashes are removed outright — an opinionated house rule of this tool, not a claim that
        humans never use them.
      </p>

      <h3 className="mt-8 font-serif text-lg font-medium text-ink tracking-tight">Pattern rules</h3>
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        {data.patterns.map((p) => (
          <div key={p.title} className="nb-card p-4">
            <p className="text-sm font-semibold text-ink">{p.title}</p>
            <p className="mt-1 text-xs text-muted leading-snug">{p.body}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-8 font-serif text-lg font-medium text-ink tracking-tight">
        Banished vocabulary
      </h3>
      <div className="mt-3 space-y-2">
        <ChipDetails label="Words" items={data.words} />
        <ChipDetails label="Phrases" items={data.phrases} />
        <ChipDetails label="Sentence starters" items={data.sentence_starters} />
      </div>

      <h3 className="mt-8 font-serif text-lg font-medium text-ink tracking-tight">
        The four rewrite lenses
      </h3>
      <p className="mt-1 text-xs text-muted max-w-2xl">
        Stage 3 (model recast) works through one or more of these, depending on what the linter
        flagged.
      </p>
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        {lenses.map((lens) => (
          <LensCard key={lens.key} lens={lens} />
        ))}
      </div>

      {guardrail && (
        <div className="mt-3 nb-card p-4" style={{ background: "#fbf1de", borderColor: "#f3d89b" }}>
          <p
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "#92600a" }}
          >
            {guardrail.title} · applies to every lens
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-snug" style={{ color: "#92600a" }}>
            {guardrail.points.map((pt) => (
              <li key={pt}>{pt}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function LensCard({ lens }: { lens: HelpLens }): JSX.Element {
  return (
    <div className={`nb-card p-4 ${LENS_ACCENT[lens.key] ?? ""}`}>
      <h4 className="text-sm font-semibold text-ink">{lens.title}</h4>
      <ul className="mt-2 space-y-1 text-xs text-muted leading-snug list-disc list-inside">
        {lens.points.map((pt) => (
          <li key={pt}>{pt}</li>
        ))}
      </ul>
    </div>
  );
}

function ChipDetails({ label, items }: { label: string; items: string[] }): JSX.Element {
  return (
    <details className="nb-card p-4">
      <summary className="text-xs font-semibold uppercase tracking-wider text-muted cursor-pointer select-none">
        {label} ({items.length})
      </summary>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center rounded-full border border-rule bg-canvas px-2 py-0.5 text-xs text-ink-2"
          >
            {item}
          </span>
        ))}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────
// #geo

function GeoSection({ levers }: { levers: HelpLever[] }): JSX.Element {
  const tiered = TIERS.map((tier, i) => ({
    ...tier,
    levers: levers.filter(
      (l) => tier.test(l.weight) && !TIERS.slice(0, i).some((t) => t.test(l.weight)),
    ),
  }));

  return (
    <section id="geo" className="scroll-mt-20">
      <SectionEyebrow label="GEO" title="What “GEO” means here" />

      <p className="mt-3 text-sm text-ink-2 leading-relaxed max-w-2xl">
        GEO — Generative Engine Optimization — is what SEO becomes when readers increasingly meet
        your writing through an AI answer instead of a blue link. Instead of crawling and ranking a
        page, an engine (ChatGPT, Perplexity, Google's AI Overviews) retrieves a handful of
        candidate passages for a query — often for several rewritten variants of that query, a
        technique Google now officially documents as query fan-out — reads them, and decides what to
        cite or paraphrase. Every lever below optimizes some part of that retrieve → read → cite
        chain.
      </p>

      <p
        className="mt-3 max-w-2xl px-3 py-2 rounded-nb-sm text-xs leading-relaxed"
        style={{ background: "#eaf0ff", color: "#1741b8" }}
      >
        Honesty note: this score measures structural readiness — traits research has correlated with
        being retrieved and cited — not a guarantee that any engine will actually cite you.
      </p>

      <div className="mt-6 space-y-6">
        {tiered.map((tier) =>
          tier.levers.length === 0 ? null : (
            <div key={tier.label}>
              <h3 className="font-serif text-lg font-medium text-ink tracking-tight">
                {tier.label}
                <span className="ml-2 text-xs font-sans font-normal text-muted-2 align-middle">
                  {tier.blurb}
                </span>
              </h3>
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                {tier.levers.map((lever) => (
                  <LeverRow key={lever.key} lever={lever} />
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function LeverRow({ lever }: { lever: HelpLever }): JSX.Element {
  return (
    <div className="nb-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-ink">{lever.label}</h4>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono tabular-nums text-muted">
            {Math.round(lever.weight * 100)}%
          </span>
          <DetectionBadge kind={lever.detection} />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted leading-snug">{lever.impact}</p>
    </div>
  );
}

function DetectionBadge({ kind }: { kind: "structural" | "judgment" }): JSX.Element {
  return kind === "structural" ? (
    <span
      className="nb-pill"
      style={{ background: "#f6f7f9", color: "#6e7682", border: "1px solid #e6e8ed" }}
    >
      structural
    </span>
  ) : (
    <span className="nb-pill" style={{ background: "#eaf0ff", color: "#1741b8" }}>
      judgment
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// #myths

function MythsSection(): JSX.Element {
  return (
    <section id="myths" className="scroll-mt-20">
      <SectionEyebrow label="Myths" title="What doesn't move the needle" />
      <p className="mt-3 text-sm text-ink-2 leading-relaxed max-w-2xl">
        A few widely-repeated GEO tactics have been tested and found to do nothing. BlogForge
        doesn't score for any of these — spending time on them is a wash at best.
      </p>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {MYTHS.map((m) => (
          <div key={m.title} className="nb-card p-4" style={{ borderLeft: "3px solid #d0d4dc" }}>
            <p className="text-sm font-semibold text-ink">{m.title}</p>
            <p className="mt-1 text-xs text-muted leading-relaxed">{m.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────
// #sources

function SourcesSection(): JSX.Element {
  return (
    <section id="sources" className="scroll-mt-20">
      <SectionEyebrow label="Sources" title="Where this comes from" />
      <ul className="mt-4 space-y-3 max-w-2xl">
        {SOURCES.map((s) => (
          <li key={s.href} className="text-sm">
            <a
              href={s.href}
              target="_blank"
              rel="noreferrer"
              className="text-cobalt-600 hover:text-cobalt-700 underline underline-offset-2 font-medium"
            >
              {s.label}
            </a>
            <p className="mt-0.5 text-xs text-muted leading-snug">{s.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────
// Shared

function SectionEyebrow({ label, title }: { label: string; title: string }): JSX.Element {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-1">{label}</p>
      <h2 className="font-serif text-2xl font-medium text-ink tracking-tight">{title}</h2>
    </>
  );
}
