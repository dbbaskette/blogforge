const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: "That GitHub account isn't on the allowlist.",
  bad_state: "Login expired — please try again.",
  oauth_denied: "GitHub sign-in was cancelled.",
  github_failed: "GitHub sign-in failed — please try again.",
  github_not_configured: "GitHub login isn't configured on this server.",
};

export function LoginPage(): JSX.Element {
  const errorCode = new URLSearchParams(window.location.search).get("error");
  const errorMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? "Sign-in error.")
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="nb-card w-full max-w-md p-8 animate-fade-up">
        <header className="mb-6 text-center">
          <div className="w-10 h-10 mx-auto rounded-[10px] bg-gradient-to-br from-cobalt-500 to-cobalt-300 grid place-items-center text-white font-serif italic font-semibold text-lg shadow-nb-cobalt mb-3">
            B
          </div>
          <h1 className="font-serif text-2xl font-medium text-ink tracking-tight">BlogForge</h1>
          <p className="text-sm text-muted mt-1">A workshop for long-form writing.</p>
        </header>

        {errorMessage && (
          <p
            className="text-sm px-3 py-2 rounded-nb-sm mb-4"
            style={{ background: "#fde7e2", color: "#b5321b", border: "1px solid #f7c3b6" }}
          >
            {errorMessage}
          </p>
        )}

        <a
          href="/api/auth/github/login"
          className="w-full inline-flex items-center justify-center gap-2.5 rounded-nb-sm px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 shadow-nb"
          style={{ background: "#24292f" }}
        >
          <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true" className="shrink-0">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}
