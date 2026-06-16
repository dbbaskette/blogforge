import { useCallback, useEffect, useState } from "react";

import { getVoiceProfile, voiceExportUrl } from "../api/voice";
import type { VoiceProfile } from "../api/voice";
import { DistilledStyle } from "../components/voice/DistilledStyle";
import { PersonaCard } from "../components/voice/PersonaCard";
import { RulesCard } from "../components/voice/RulesCard";
import { SamplesList } from "../components/voice/SamplesList";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

export function VoicePage(): JSX.Element {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const p = await getVoiceProfile();
      setProfile(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleChange = useCallback((updated: VoiceProfile): void => {
    setProfile(updated);
  }, []);

  const handleRefresh = useCallback(async (): Promise<void> => {
    await load();
  }, [load]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10">
        <p className="text-center text-muted text-sm py-12">Loading voice profile…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10">
        <div
          className="px-4 py-3 rounded-nb-sm text-sm"
          style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
        >
          Failed to load voice profile: {error}
        </div>
      </div>
    );
  }

  if (!profile) return <></>;

  const statusLine = [
    profile.distilled_at
      ? `distilled ${relativeTime(profile.distilled_at)}`
      : "not distilled yet",
    `${profile.samples.length} ${profile.samples.length === 1 ? "sample" : "samples"}`,
    "used by default on every draft",
  ].join(" · ");

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
            Voice
          </p>
          <h1 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight">
            Your voice
          </h1>
          <p className="text-sm text-muted mt-2">{statusLine}</p>
        </div>
        <a
          href={voiceExportUrl()}
          download
          className="nb-btn nb-btn-sm nb-btn-ghost shrink-0 mt-2"
        >
          Download pack
        </a>
      </header>

      <PersonaCard profile={profile} onChange={handleChange} />
      <RulesCard profile={profile} onChange={handleChange} />
      <SamplesList profile={profile} onChange={handleChange} onRefresh={handleRefresh} />
      <DistilledStyle profile={profile} onChange={handleChange} />
    </div>
  );
}
