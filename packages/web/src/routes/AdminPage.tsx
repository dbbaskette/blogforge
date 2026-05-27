import { useCallback, useEffect, useState } from "react";

import {
  type AdminUser,
  approveUser,
  disableUser,
  listUsers,
  promoteUser,
  rejectUser,
} from "../api/admin";

export function AdminPage(): JSX.Element {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listUsers()
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const handle = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (users === null && !error) {
    return <p className="text-center text-muted text-sm py-16">Loading…</p>;
  }

  const pending = (users ?? []).filter((u) => u.status === "pending");
  const others = (users ?? []).filter((u) => u.status !== "pending");

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
          Admin
        </p>
        <h1 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight">
          Users
        </h1>
      </header>

      {error && (
        <div
          className="mb-6 p-4 rounded-nb"
          style={{ background: "#fde9ec", border: "1px solid #f7c7cf", color: "#94293c" }}
        >
          {error}
        </div>
      )}

      <section className="mb-8">
        <h2 className="font-serif text-xl font-medium text-ink mb-3">
          Pending requests{" "}
          <span className="font-mono text-sm text-muted">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="nb-card p-6 text-center italic text-muted">No pending requests.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((u) => (
              <li key={u.id} className="nb-card p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-ink">{u.email}</div>
                  <div className="text-xs text-muted">
                    Requested {new Date(u.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handle(() => approveUser(u.id))}
                    className="nb-btn nb-btn-primary nb-btn-sm"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handle(() => rejectUser(u.id))}
                    className="nb-btn nb-btn-sm"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl font-medium text-ink mb-3">
          All users <span className="font-mono text-sm text-muted">({others.length})</span>
        </h2>
        <ul className="space-y-2">
          {others.map((u) => (
            <li key={u.id} className="nb-card p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-ink">{u.email}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`nb-pill nb-pill-${
                      u.status === "approved"
                        ? "ready"
                        : u.status === "rejected"
                          ? "failed"
                          : "empty"
                    }`}
                  >
                    <span className="dot" />
                    {u.status}
                  </span>
                  {u.role === "admin" && (
                    <span className="nb-pill nb-pill-edited">
                      <span className="dot" />
                      admin
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {u.status === "approved" && u.role !== "admin" && (
                  <button
                    type="button"
                    onClick={() => handle(() => promoteUser(u.id))}
                    className="nb-btn nb-btn-sm"
                  >
                    Promote
                  </button>
                )}
                {u.status === "approved" && (
                  <button
                    type="button"
                    onClick={() => handle(() => disableUser(u.id))}
                    className="nb-btn nb-btn-sm"
                  >
                    Disable
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
