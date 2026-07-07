import { useEffect, useRef } from "react";

// Living "humanness" pulse: a line whose amplitude + irregularity scale with the
// human-signal score. Flat dashed baseline = the robot zero. Below it, the two
// sub-scores (anti-robot lint + human-signal) that blend into the number.

const N = 160;
function seededNoise(): number[] {
  let s = 1337;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const a = Array.from({ length: N }, () => r() * 2 - 1);
  return a.map((_, i) => (a[(i - 1 + N) % N] + 2 * a[i] + a[(i + 1) % N]) / 4);
}
const PN = seededNoise();

function pulsePath(human: number, phase: number): string {
  let d = "";
  for (let k = 0; k <= N; k++) {
    const x = (k / N) * 640;
    const t = k / N;
    const beat = Math.exp(-Math.pow((((t * 4.3 + PN[k % N] * 0.12 * human) % 1) - 0.5) * 9, 2));
    const w =
      0.5 * Math.sin(t * 9 + phase) +
      0.28 * Math.sin(t * 17 + phase * 1.7) +
      0.5 * PN[k % N] +
      0.9 * beat;
    const y = Math.max(6, Math.min(126, 72 - human * 38 * w));
    d += `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
// Mirrors checkup.ts blendHumanness (Task F1) — inlined for the spike.
function blend(antiRobot: number, humanSignal: number | null): number {
  if (humanSignal == null) return clamp(antiRobot);
  return clamp(0.5 * antiRobot + 0.5 * humanSignal);
}
function scoreColor(s: number): string {
  return s >= 70 ? "#0e7a50" : s >= 45 ? "#92600a" : "#b5321b";
}

export function HumannessPulse({
  antiRobot,
  humanSignal,
}: {
  antiRobot: number;
  humanSignal: number | null;
}) {
  const score = blend(antiRobot, humanSignal);
  const human = Math.max(0.15, score / 100);
  const pathRef = useRef<SVGPathElement>(null);
  const humanRef = useRef(human);
  humanRef.current = human;

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduce) {
      pathRef.current?.setAttribute("d", pulsePath(humanRef.current, 0));
      return;
    }
    let phase = 0;
    let raf = 0;
    const tick = () => {
      phase += 0.028;
      pathRef.current?.setAttribute("d", pulsePath(humanRef.current, phase));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hs = humanSignal ?? 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <svg
          viewBox="0 0 640 132"
          width="100%"
          preserveAspectRatio="none"
          style={{ height: 100, flex: 1 }}
          aria-hidden="true"
        >
          <line x1="0" y1="72" x2="640" y2="72" stroke="#d0d4dc" strokeDasharray="3 6" />
          <path
            ref={pathRef}
            d=""
            fill="none"
            stroke="#2f6bff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="text-right" style={{ minWidth: 70 }}>
          <div style={{ fontSize: 34, fontWeight: 500, lineHeight: 1, color: scoreColor(score) }}>
            {score}
          </div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>
            reads human
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-muted" style={{ fontSize: 11 }}>
        <span style={{ width: 72 }}>anti-robot</span>
        <span
          className="rounded-full"
          style={{ flex: 1, height: 7, background: "#eef0f3", border: "1px solid #e6e8ed", overflow: "hidden" }}
        >
          <span style={{ display: "block", height: "100%", width: `${antiRobot}%`, background: "#aab1bd" }} />
        </span>
        <span style={{ width: 78 }}>human signal</span>
        <span
          className="rounded-full"
          style={{ flex: 1, height: 7, background: "#eef0f3", border: "1px solid #e6e8ed", overflow: "hidden" }}
        >
          <span style={{ display: "block", height: "100%", width: `${hs}%`, background: "#15a06b" }} />
        </span>
      </div>
    </div>
  );
}
