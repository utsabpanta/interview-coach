import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a crash anywhere in the app and says what happened, instead of
 * leaving a blank page. The details shown contain no answers and no keys:
 * only the error and where in the code it came from.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; where: string; copied: boolean }> {
  state = { error: null as Error | null, where: "", copied: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ where: info.componentStack ?? "" });
  }

  render() {
    const { error, where, copied } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${(error.stack ?? "").split("\n").slice(1, 6).join("\n")}\n${where.split("\n").slice(0, 6).join("\n")}\n${navigator.userAgent}`;
    const copy = () => {
      void navigator.clipboard?.writeText(details).then(() => this.setState({ copied: true }));
    };
    return (
      <main className="crash">
        <h1>Something went wrong</h1>
        <p>
          The app hit an error it could not recover from, and this interview could not be saved. Your settings and history are untouched. Please
          report it so it can be fixed; the details below include no answers and no API keys.
        </p>
        <pre>{details}</pre>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            Start again
          </button>
          <button type="button" className="btn ghost" onClick={copy}>
            {copied ? "Copied" : "Copy details"}
          </button>
          <a className="btn ghost" href="https://github.com/utsabpanta/interview-coach/issues/new/choose" target="_blank" rel="noreferrer">
            Report it
          </a>
        </div>
      </main>
    );
  }
}
