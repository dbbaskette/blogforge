import { type KeyboardEvent, useState } from "react";

import { updateRules } from "../../api/voice";
import type { VoiceProfile, VoiceRules } from "../../api/voice";
import { Icon } from "../ui/Icon";

interface RulesCardProps {
  profile: VoiceProfile;
  onChange: (updated: VoiceProfile) => void;
}

export function RulesCard({ profile, onChange }: RulesCardProps): JSX.Element {
  const [rules, setRules] = useState<VoiceRules>(profile.rules);
  const [newWord, setNewWord] = useState("");
  const [newPhrase, setNewPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const persist = async (next: VoiceRules): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateRules(next);
      setRules(updated.rules);
      onChange(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const removeWord = (word: string): void => {
    const next = { ...rules, banished_words: rules.banished_words.filter((w) => w !== word) };
    setRules(next);
    void persist(next);
  };

  const addWord = (): void => {
    const trimmed = newWord.trim();
    if (!trimmed || rules.banished_words.includes(trimmed)) {
      setNewWord("");
      return;
    }
    const next = { ...rules, banished_words: [...rules.banished_words, trimmed] };
    setRules(next);
    setNewWord("");
    void persist(next);
  };

  const removePhrase = (phrase: string): void => {
    const next = {
      ...rules,
      banished_phrases: rules.banished_phrases.filter((p) => p !== phrase),
    };
    setRules(next);
    void persist(next);
  };

  const addPhrase = (): void => {
    const trimmed = newPhrase.trim();
    if (!trimmed || rules.banished_phrases.includes(trimmed)) {
      setNewPhrase("");
      return;
    }
    const next = { ...rules, banished_phrases: [...rules.banished_phrases, trimmed] };
    setRules(next);
    setNewPhrase("");
    void persist(next);
  };

  const toggleRule = (key: "no_em_dashes" | "no_ascii_double_hyphen"): void => {
    const next = { ...rules, [key]: !rules[key] };
    setRules(next);
    void persist(next);
  };

  const handleWordKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") addWord();
  };

  const handlePhraseKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") addPhrase();
  };

  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl font-medium text-ink mb-3">Rules</h2>
      <div className="nb-card p-6 space-y-6">
        {/* Banished words */}
        <div>
          <p className="nb-label">Banished words</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {rules.banished_words.map((word) => (
              <span
                key={word}
                className="nb-pill inline-flex items-center gap-1.5"
                style={{ background: "#fde9ec", color: "#94293c" }}
              >
                {word}
                <button
                  type="button"
                  onClick={() => removeWord(word)}
                  aria-label={`Remove word ${word}`}
                  className="hover:opacity-70 transition-opacity"
                >
                  <Icon name="x" size={12} title="" />
                </button>
              </span>
            ))}
            {rules.banished_words.length === 0 && (
              <span className="text-xs text-muted italic">No banished words yet</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={handleWordKeyDown}
              placeholder="Add a word…"
              className="nb-input flex-1"
            />
            <button
              type="button"
              onClick={addWord}
              disabled={!newWord.trim() || saving}
              className="nb-btn nb-btn-sm"
            >
              Add
            </button>
          </div>
        </div>

        <hr className="nb-rule" />

        {/* Banished phrases */}
        <div>
          <p className="nb-label">Banished phrases</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {rules.banished_phrases.map((phrase) => (
              <span
                key={phrase}
                className="nb-pill inline-flex items-center gap-1.5"
                style={{ background: "#fde9ec", color: "#94293c" }}
              >
                {phrase}
                <button
                  type="button"
                  onClick={() => removePhrase(phrase)}
                  aria-label={`Remove phrase ${phrase}`}
                  className="hover:opacity-70 transition-opacity"
                >
                  <Icon name="x" size={12} title="" />
                </button>
              </span>
            ))}
            {rules.banished_phrases.length === 0 && (
              <span className="text-xs text-muted italic">No banished phrases yet</span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newPhrase}
              onChange={(e) => setNewPhrase(e.target.value)}
              onKeyDown={handlePhraseKeyDown}
              placeholder="Add a phrase…"
              className="nb-input flex-1"
            />
            <button
              type="button"
              onClick={addPhrase}
              disabled={!newPhrase.trim() || saving}
              className="nb-btn nb-btn-sm"
            >
              Add
            </button>
          </div>
        </div>

        <hr className="nb-rule" />

        {/* Toggle rules */}
        <div className="space-y-3">
          <p className="nb-label">Style toggles</p>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rules.no_em_dashes}
              onChange={() => toggleRule("no_em_dashes")}
              className="w-4 h-4 accent-cobalt-600"
            />
            <span className="text-sm text-ink">No em dashes (—)</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rules.no_ascii_double_hyphen}
              onChange={() => toggleRule("no_ascii_double_hyphen")}
              className="w-4 h-4 accent-cobalt-600"
            />
            <span className="text-sm text-ink">No ASCII double-hyphen (--)</span>
          </label>
        </div>

        {error && (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm"
            style={{ background: "#fde9ec", color: "#94293c", border: "1px solid #f7c7cf" }}
          >
            {error}
          </p>
        )}

        {savedFlash && (
          <span className="text-xs font-medium" style={{ color: "#1f7752" }}>
            Saved
          </span>
        )}
      </div>
    </section>
  );
}
