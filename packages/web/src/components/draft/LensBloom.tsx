// Lens-bloom radar: 4 axes (flow / voice / imperfections / soul). Engaged lenses
// extend; idle ones hug the center. Blooms more as the intensity dial rises.

export type LensKey = "flow" | "voice" | "imperfections" | "soul";
const ORDER: LensKey[] = ["flow", "voice", "imperfections", "soul"];
const AXES: Record<LensKey, [number, number]> = {
  flow: [0, -1],
  voice: [1, 0],
  imperfections: [0, 1],
  soul: [-1, 0],
};
const LABEL: Record<LensKey, string> = {
  flow: "flow",
  voice: "voice",
  imperfections: "imperfections",
  soul: "soul",
};

// Each lens gets its own hue from the app's semantic palette.
export const LENS_COLOR: Record<LensKey, string> = {
  flow: "#2f6bff", // cobalt
  voice: "#16c2b3", // teal
  imperfections: "#f59e0b", // amber
  soul: "#e6492d", // coral
};

export function radiiForLenses(
  engaged: LensKey[],
  counts: Record<LensKey, number>,
): Record<LensKey, number> {
  const out = {} as Record<LensKey, number>;
  for (const k of ORDER) {
    if (!engaged.includes(k)) {
      out[k] = 0.16;
      continue;
    }
    const penalty = Math.min(counts[k] ?? 0, 4) * 0.08;
    out[k] = Math.max(0.5, 0.92 - penalty);
  }
  return out;
}

export function LensBloom({
  engaged,
  counts,
}: {
  engaged: LensKey[];
  counts: Record<LensKey, number>;
}) {
  const r = radiiForLenses(engaged, counts);
  const R = 70;
  const C = 100;
  const pts = ORDER.map(
    (k) => `${(C + AXES[k][0] * R * r[k]).toFixed(1)},${(C + AXES[k][1] * R * r[k]).toFixed(1)}`,
  ).join(" ");
  return (
    <svg viewBox="0 0 200 200" width="100%" style={{ height: 156 }} aria-hidden="true">
      <polygon points="100,30 170,100 100,170 30,100" fill="none" stroke="#e6e8ed" />
      <polygon points="100,65 135,100 100,135 65,100" fill="none" stroke="#e6e8ed" />
      {/* colored spokes, per lens */}
      {ORDER.map((k) => {
        const [dx, dy] = AXES[k];
        const on = engaged.includes(k);
        return (
          <line
            key={`sp-${k}`}
            x1="100"
            y1="100"
            x2={C + dx * R * r[k]}
            y2={C + dy * R * r[k]}
            stroke={on ? LENS_COLOR[k] : "#e6e8ed"}
            strokeWidth={on ? 2 : 1}
            strokeLinecap="round"
            style={{ transition: "all .5s cubic-bezier(.2,.7,.2,1)" }}
          />
        );
      })}
      <polygon
        points={pts}
        fill="#2f6bff"
        fillOpacity="0.08"
        stroke="#adc6ff"
        strokeWidth="1.5"
        style={{ transition: "all .5s cubic-bezier(.2,.7,.2,1)" }}
      />
      {/* colored vertex dots + labels */}
      {ORDER.map((k) => {
        const [dx, dy] = AXES[k];
        const on = engaged.includes(k);
        return (
          <g key={k}>
            <circle
              cx={C + dx * R * r[k]}
              cy={C + dy * R * r[k]}
              r={on ? 4 : 2.5}
              fill={on ? LENS_COLOR[k] : "#c7ccd6"}
              style={{ transition: "all .5s cubic-bezier(.2,.7,.2,1)" }}
            />
            <text
              x={C + dx * 90}
              y={C + dy * 90 + 3}
              textAnchor={dx > 0 ? "start" : dx < 0 ? "end" : "middle"}
              style={{
                fontSize: 11,
                fontWeight: on ? 500 : 400,
                fontFamily: '"Inter", sans-serif',
                fill: on ? LENS_COLOR[k] : "#aab1bd",
                opacity: on ? 1 : 0.7,
                transition: "fill .3s, opacity .3s",
              }}
            >
              {LABEL[k]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
