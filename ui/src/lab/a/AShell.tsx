import type { ReactNode } from "react";
import type { VerificationState } from "../../domain/view";
import { MarkCalibration } from "../brand/marks";
import "./a.css";

export const lamp = (s: VerificationState, off = false) => <i className="a-lamp" data-s={s} data-off={off || undefined} aria-hidden />;

export function AState({ state }: { state: VerificationState }) {
  return (
    <span className="a-state" data-s={state}>
      {lamp(state)}
      {state}
    </span>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    <path d={d} />
  </svg>
);

export function AShell({ page, children }: { page: "overview" | "detail"; children: ReactNode }) {
  return (
    <div className="a-root">
      <aside className="a-rail">
        <MarkCalibration size={26} />
        <nav aria-label="Primary">
          <a href="#/a/overview" aria-current={page === "overview" ? "page" : undefined}>
            <Icon d="M2.5 13.5h3v-5h-3zM7.5 13.5h3v-9h-3zM12.5 13.5h3v-7h-3z" />
            Console
          </a>
          <a href="#/a/detail" aria-current={page === "detail" ? "page" : undefined}>
            <Icon d="M3 4.5h12M3 9h12M3 13.5h7" />
            Runs
          </a>
        </nav>
        <i className="a-rail-sep" />
        <nav aria-label="Not in this preview">
          <span aria-disabled="true" title="Not available in this research preview">
            <Icon d="M5 6.5h8M5 11.5h8M6.5 4v5M11.5 9v5" />
            Links
          </span>
          <span aria-disabled="true" title="Not available in this research preview">
            <Icon d="M4 3.5h10v11H4zM6.5 7h5M6.5 10h3" />
            Rules
          </span>
        </nav>
      </aside>
      <main className="a-page">
        <div className="a-top">
          <div className="a-top-left">
            <span className="a-word">
              <b>FlowAssert</b> <span>/ console</span>
            </span>
            <span className="a-demo a-cap">
              <i aria-hidden /> Demo signal · synthetic
            </span>
          </div>
          <span className="a-clock">
            clock <b>2026-10-16 14:30:00 UTC</b> · fixed
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}
