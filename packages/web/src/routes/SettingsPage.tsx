import { useMe } from "../hooks/useMe";

export function SettingsPage(): JSX.Element {
  const { user } = useMe();

  return (
    <div className="max-w-5xl mx-auto px-6 lg:px-10 py-10 animate-fade-up">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-cobalt-600 mb-2">
          Settings
        </p>
        <h1 className="font-serif text-3xl md:text-4xl font-medium text-ink leading-tight tracking-tight">
          Account
        </h1>
      </header>

      <section>
        <div className="nb-card p-6">
          {user ? (
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted w-24">Email</dt>
                <dd className="text-ink font-medium">{user.email}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted w-24">Role</dt>
                <dd className="text-ink font-medium">{user.role}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-center text-muted text-sm py-4">Loading…</p>
          )}
        </div>
      </section>
    </div>
  );
}
