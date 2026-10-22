import type { ReactNode } from "react";
import type { VerificationState } from "../../domain/view";
import { MarkTrace } from "../brand/marks";
import "./c.css";

export const glyph = (s: VerificationState | "unknown") => <i className="c-glyph" data-s={s} aria-hidden />;

export function Seal({ state }: { state: VerificationState }) {
  return (
    <span className="c-seal" data-s={state}>
      {glyph(state)}
      {state}
    </span>
  );
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
export const word = (n: number, lower = false) => {
  const w = WORDS[n] ?? String(n);
  return lower ? w.toLowerCase() : w;
};

export function CShell({ page, crumbs, children }: { page: "overview" | "detail"; crumbs: ReactNode; children: ReactNode }) {
  return (
    <div className="c-root">
      <aside className="c-rail">
        <div className="c-brand">
          <MarkTrace size={26} />
          <span className="c-wordmark">
            Flow<i>Assert</i>
          </span>
        </div>
        <nav aria-label="Primary">
          <div className="c-nav">
            <a href="#/c/overview" aria-current={page === "overview" ? "page" : undefined}>
              <span className="c-nav-num">01</span>Register
            </a>
            <a href="#/c/detail" aria-current={page === "detail" ? "page" : undefined}>
              <span className="c-nav-num">02</span>Cases
            </a>
          </div>
          <p className="c-nav-label">Not in this preview</p>
          <div className="c-nav">
            <span aria-disabled="true">
              <span className="c-nav-num">—</span>Sources &amp; destinations
            </span>
            <span aria-disabled="true">
              <span className="c-nav-num">—</span>Rules
            </span>
            <span aria-disabled="true">
              <span className="c-nav-num">—</span>Settings
            </span>
          </div>
        </nav>
        <div className="c-stamp">
          <b>Demo register</b>
          Synthetic records from the research contract. No live n8n or HubSpot.
        </div>
      </aside>
      <main className="c-page">
        <div className="c-topbar">
          <div className="c-crumbs">{crumbs}</div>
          <div className="c-clock">
            clock fixed · <em>16 Oct 2026 14:30 UTC</em>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
