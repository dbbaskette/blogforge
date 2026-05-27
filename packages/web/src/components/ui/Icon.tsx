/**
 * Tiny icon set. Strokes a 24x24 viewBox at currentColor.
 * Each icon includes an accessible <title> for screenreaders;
 * pass `title=""` to hide it from biome (use sparingly, and only when a parent
 * already labels the icon — e.g. an aria-labelled button).
 */

interface IconProps {
  name: IconName;
  title?: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export type IconName =
  | "chevron-right"
  | "chevron-down"
  | "chevron-up"
  | "plus"
  | "x"
  | "trash"
  | "rotate"
  | "file-plus"
  | "more";

export function Icon({
  name,
  title,
  size = 16,
  strokeWidth = 2,
  className,
}: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label={title ?? name}
    >
      <title>{title ?? name}</title>
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<IconName, JSX.Element> = {
  "chevron-right": <polyline points="9 18 15 12 9 6" />,
  "chevron-down": <polyline points="6 9 12 15 18 9" />,
  "chevron-up": <polyline points="18 15 12 9 6 15" />,
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  x: <path d="M18 6L6 18M6 6l12 12" />,
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  rotate: (
    <>
      <path d="M21 12a9 9 0 11-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  "file-plus": (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
};
