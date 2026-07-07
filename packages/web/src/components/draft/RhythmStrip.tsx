// Sentence-rhythm strip: a bar per sentence, height = word count. Uniform bars
// read as metronomic/machine; jagged bars read as human burstiness.

export function sentenceLengths(text: string): number[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).filter(Boolean).length);
}

export function rhythmVariance(lengths: number[]): number {
  if (lengths.length < 2) return 0;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const v = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(v);
}

export function RhythmStrip({ text }: { text: string }) {
  const lens = sentenceLengths(text).slice(0, 24);
  const max = Math.max(1, ...lens);
  const metronomic = lens.length > 3 && rhythmVariance(lens) < 3;
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 64 }}>
        {lens.map((n, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(8, (n / max) * 100)}%`,
              background: "#2f6bff",
              opacity: 0.55,
              borderRadius: "3px 3px 0 0",
              transition: "height .5s cubic-bezier(.2,.7,.2,1)",
            }}
          />
        ))}
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
        {metronomic ? "even, metronomic beats read as machine" : "varied lengths read as human"}
      </div>
    </div>
  );
}
