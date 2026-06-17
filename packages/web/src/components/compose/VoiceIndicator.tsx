import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getVoiceProfile } from "../../api/voice";

export function VoiceIndicator(): JSX.Element {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    getVoiceProfile()
      .then((p) => setName(p.name ?? null))
      .catch(() => setName(null));
  }, []);
  return (
    <span className="glass-card inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink">
      ✍ writing as <b className="text-cobalt-700">{name ?? "your voice"}</b>
      <Link to="/voice" className="text-cobalt-600 hover:text-cobalt-700">· edit</Link>
    </span>
  );
}
