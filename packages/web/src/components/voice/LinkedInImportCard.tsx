import { useRef, useState } from "react";

import { importLinkedIn } from "../../api/voice";

export function LinkedInImportCard({ onImported }: { onImported: () => void }): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const prof = await importLinkedIn(file);
      setMsg(`Prefilled your persona and added ${prof.samples.length} sample(s). Review below, then Distill.`);
      onImported();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Import failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="nb-card p-6">
      <h2 className="font-serif text-xl font-medium text-ink mb-2">Import from LinkedIn</h2>
      <p className="text-sm text-muted mb-3">
        LinkedIn blocks automatic fetching, so import your official data export (it's quick):
      </p>
      <ol className="text-sm text-muted list-decimal ml-5 space-y-1 mb-4">
        <li>LinkedIn → <b>Settings &amp; Privacy → Data Privacy → Get a copy of your data</b></li>
        <li>Select <b>Profile</b> (and <b>Articles</b>) → <b>Request archive</b></li>
        <li>Wait for LinkedIn's email, download the <code>.zip</code></li>
        <li>Upload it here ⤵</li>
      </ol>
      <div className="flex items-center gap-3 flex-wrap">
        <a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer"
           className="nb-btn nb-btn-sm nb-btn-ghost">Open LinkedIn data export ↗</a>
        <input ref={fileRef} type="file" accept=".zip" onChange={onPick} disabled={busy} className="text-sm" />
      </div>
      {busy && <p className="text-sm text-muted mt-2">Importing…</p>}
      {msg && <p className="text-sm mt-2" style={{ color: "#1f7a4d" }}>{msg}</p>}
      {err && <p className="text-sm mt-2" style={{ color: "#b5321b" }}>{err}</p>}
    </section>
  );
}
