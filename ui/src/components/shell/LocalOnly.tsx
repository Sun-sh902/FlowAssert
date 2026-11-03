/**
 * In the GitHub Pages demo, the pages that read the local FlowAssert Service show this instead: they work only on a
 * computer running the Service, and this build never tries to reach it (its Content Security Policy forbids any
 * connection). The CSV check and the MOCK demo pages work here.
 */
import { buttonClass, Panel } from "../ui/primitives";

export function LocalOnly() {
  return (
    <Panel>
      <div className="px-5 py-8 sm:px-8" data-local-only>
        <p className="kicker">Online demo</p>
        <h1 className="display mt-2 text-[30px] leading-[1.1] text-ink">Works only locally</h1>
        <p className="mt-3 max-w-[62ch] text-md leading-[1.6] text-ink-2">
          This page reads the FlowAssert Service running on your own computer. This online demo has no Service and makes no request to one, so the page shows
          nothing here. Run FlowAssert locally to use it; the UI README explains how.
        </p>
        <p className="mt-2 max-w-[62ch] text-sm leading-[1.6] text-ink-3">The CSV check and the demo pages work in this online demo.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <a className={buttonClass("primary")} href="#/check">
            Open the CSV check
          </a>
          <a className={buttonClass()} href="#/demo">
            Open the demo overview
          </a>
        </div>
      </div>
    </Panel>
  );
}
