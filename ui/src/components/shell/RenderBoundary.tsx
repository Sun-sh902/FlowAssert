/**
 * A render failure stops at this boundary, so it can never leave a blank page or a partly drawn result. It reports only
 * that the page could not be drawn: nothing here is a verdict, and no error detail is shown. App keys it by path, so
 * navigating away clears it; the outer one in main.tsx catches a failure of the shell itself.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export class RenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" data-render-failure style={{ padding: 24 }}>
        <h1 className="text-sm font-medium text-ink">This page could not be drawn</h1>
        <p className="mt-1 max-w-sm text-sm text-ink-3">The browser stopped while drawing it. No result is shown, and this says nothing about any verification.</p>
        <p className="mt-4">
          <a className="fa-hit text-sm underline" href="#/" onClick={() => window.location.reload()}>
            Reload from Overview
          </a>
        </p>
      </div>
    );
  }
}
