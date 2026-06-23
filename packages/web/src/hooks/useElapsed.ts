import { useEffect, useState } from "react";

/**
 * Seconds elapsed since `active` last became true. Resets to 0 whenever
 * `active` goes false. Used to give blocking AI operations (hero image,
 * repurpose, fact-check, distill) a live "…12s" counter instead of a bare
 * spinner, so the user can tell work is progressing rather than hung.
 */
export function useElapsed(active: boolean): number {
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!active) {
      setSecs(0);
      return;
    }
    setSecs(0);
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return secs;
}
