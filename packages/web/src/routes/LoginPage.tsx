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

        <a href="/api/auth/github/login" className="nb-btn nb-btn-primary w-full text-center block">
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}
