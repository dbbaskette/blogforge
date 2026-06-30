import { useCallback, useEffect, useState } from "react";

import { getVoiceFingerprint } from "../../api/voice";
import type { VoiceFingerprint as Fingerprint, VoiceDimensions } from "../../api/voice";

// Radar geometry — viewBox padded so the axis labels never clip.
const CX = 130;
const CY = 112;
const R = 78;

// Axis order matches the spec: 60° apart, starting at top, clockwise.
const AXES: { key: keyof VoiceDimensions; label: string }[] = [
  { key: "casual", label: "Casual" },
  { key: "vivid", label: "Vivid" },
  { key: "punchy", label: "Punchy" },
  { key: "warm", label: "Warm" },
  { key: "concrete", label: "Concrete" },
  { key: "direct", label: "Direct" },
];

/** Point on an axis at the given 0–100 magnitude. */
function axisPoint(index: number, magnitude: number): { x: number; y: number } {
  const angle = (-90 + index * 60) * (Math.PI / 180);
  const radius = R * (magnitude / 100);
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

function polygonPoints(values: number[]): string {
  return values.map((v, i) => `${axisPoint(i, v).x},${axisPoint(i, v).y}`).join(" ");
}

function VoiceRadar({ dimensions }: { dimensions: VoiceDimensions }): JSX.Element {
  const values = AXES.map(({ key }) => Math.max(0, Math.min(100, dimensions[key])));
  const outerHex = polygonPoints(AXES.map(() => 100));
  const innerHex = polygonPoints(AXES.map(() => 50));
  const valueHex = polygonPoints(values);

  return (
    <svg
      viewBox="0 0 260 220"
      width="100%"
      height="100%"
      role="img"
      aria-label="Voice fingerprint radar across six tonal axes"
    >
      {/* Grid: outer hexagon + one inner gridline */}
      <polygon points={outerHex} fill="none" stroke="#e6e8ed" strokeWidth={1} />
      <polygon points={innerHex} fill="none" stroke="#e6e8ed" strokeWidth={1} />

      {/* Axis spokes */}
      {AXES.map(({ key }, i) => {
        const end = axisPoint(i, 100);
        return (
          <line
            key={`spoke-${key}`}
            x1={CX}
            y1={CY}
            x2={end.x}
            y2={end.y}
            stroke="#e6e8ed"
            strokeWidth={1}
          />
        );
      })}

      {/* Value polygon */}
      <polygon
        points={valueHex}
        fill="#2f6bff"
        fillOpacity={0.16}
        stroke="#2f6bff"
        strokeWidth={2}
      />

      {/* Vertex dots */}
      {values.map((v, i) => {
        const p = axisPoint(i, v);
        return <circle key={`dot-${AXES[i].key}`} cx={p.x} cy={p.y} r={2.5} fill="#2f6bff" />;
      })}

      {/* Axis labels just outside the outer hexagon */}
      {AXES.map(({ key, label }, i) => {
        const p = axisPoint(i, 122);
        const anchor = p.x > CX + 4 ? "start" : p.x < CX - 4 ? "end" : "middle";
        return (
          <text
            key={`label-${key}`}
            x={p.x}
            y={p.y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={10}
            fontWeight={600}
            fill="#6e7682"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/** Stable, collision-free keys for arrays of repeatable primitives. */
function keyed<T>(items: T[]): { value: T; key: string }[] {
  const seen = new Map<string, number>();
  return items.map((value) => {
    const base = String(value);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { value, key: `${base}#${n}` };
  });
}

function Chips({ items }: { items: string[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {keyed(items).map(({ value, key }) => (
        <span
          key={key}
          className="inline-block rounded-full bg-cobalt-50 px-2.5 py-1 text-xs font-medium text-cobalt-700"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

/** Sentence-rhythm sparkbars — each value (≈0–40 words) becomes a bar height. */
function RhythmBars({ rhythm }: { rhythm: number[] }): JSX.Element {
  const max = Math.max(40, ...rhythm);
  return (
    <div className="flex items-end gap-1 h-12" aria-hidden>
      {keyed(rhythm).map(({ value: len, key }) => {
        const pct = Math.max(6, Math.round((len / max) * 100));
        return (
          <span
            key={key}
            className="flex-1 rounded-t-sm bg-cobalt-400"
            style={{ height: `${pct}%`, minWidth: 3 }}
            title={`${len} words`}
          />
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      {children}
    </div>
  );
}

export function VoiceFingerprint(): JSX.Element {
  const [fp, setFp] = useState<Fingerprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setFp(await getVoiceFingerprint());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl font-medium text-ink">Voice fingerprint</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="nb-btn nb-btn-sm nb-btn-ghost"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="nb-card p-6">
        {loading && !fp ? (
          <p className="text-sm text-muted italic font-serif">Reading your voice…</p>
        ) : error ? (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm"
            style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
          >
            Couldn't load your fingerprint: {error}
          </p>
        ) : fp ? (
          <FingerprintBody fp={fp} />
        ) : null}
      </div>
    </section>
  );
}

function FingerprintBody({ fp }: { fp: Fingerprint }): JSX.Element {
  const empty = fp.sample_count === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-1">
            Voice fingerprint
          </p>
          <h3 className="font-serif text-2xl font-medium text-ink leading-tight">{fp.name}</h3>
          {fp.one_line && (
            <p className="mt-1 text-sm italic text-muted font-serif">{fp.one_line}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-semibold text-cobalt-600 leading-none tabular-nums">
            {fp.strength}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
            voice strength
          </p>
        </div>
      </div>

      {empty ? (
        <p className="text-sm text-muted italic font-serif py-2">
          Add writing samples to generate your fingerprint.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 md:items-center">
          {/* Radar (or placeholder) */}
          <div className="flex items-center justify-center min-h-[200px]">
            {fp.dimensions ? (
              <VoiceRadar dimensions={fp.dimensions} />
            ) : (
              <p className="text-sm text-muted italic font-serif text-center px-4 max-w-xs">
                Add a few writing samples and a model to map your tones.
              </p>
            )}
          </div>

          {/* Details */}
          <div className="space-y-5">
            {fp.signature_phrases.length > 0 && (
              <Section title="Signature phrases">
                <Chips items={fp.signature_phrases} />
              </Section>
            )}

            {fp.rhythm.length > 0 && (
              <Section title={`Sentence rhythm · ~${Math.round(fp.avg_sentence_len)} words avg`}>
                <RhythmBars rhythm={fp.rhythm} />
              </Section>
            )}

            {fp.top_words.length > 0 && (
              <Section title="Top words">
                <p className="text-sm text-ink-2 leading-relaxed">{fp.top_words.join(" · ")}</p>
              </Section>
            )}

            {fp.banished.length > 0 && (
              <Section title="Banished">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {keyed(fp.banished).map(({ value, key }) => (
                    <span key={key} className="text-sm text-muted line-through">
                      {value}
                    </span>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
