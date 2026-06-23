import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render-time errors so one broken component can't white-screen the app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="nb-card w-full max-w-md p-8 text-center">
            <h1 className="font-serif text-xl font-medium text-ink mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-muted mb-5">
              An unexpected error broke this view. Reloading usually fixes it.
            </p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={this.reset}
                className="nb-btn nb-btn-sm"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="nb-btn nb-btn-sm nb-btn-primary"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
