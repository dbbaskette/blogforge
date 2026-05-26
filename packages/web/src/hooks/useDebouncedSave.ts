import { useEffect, useRef, useState } from "react";

export function useDebouncedSave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  delay = 500,
): { saving: boolean; lastSavedAt: Date | null; error: string | null } {
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initial = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setSaving(true);
      setError(null);
      try {
        await saveRef.current(value);
        setLastSavedAt(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return { saving, lastSavedAt, error };
}
