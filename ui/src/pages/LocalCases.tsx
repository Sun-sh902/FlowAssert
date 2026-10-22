import { ArrowRight } from "lucide-react";
import { LocalModeStamp } from "../components/local/LocalResearch";
import { PageHead } from "../components/ui/atelier";
import { Panel } from "../components/ui/primitives";
import { KNOWN_LOCAL_CASES, LOCAL_SERVICE_TARGET } from "../data/local/config";
import { href } from "../lib/router";

/**
 * Entry to the LOCAL_RESEARCH pages. The accepted service has no list endpoint, so this page lists
 * only the five reviewed case IDs from the Phase 2 handoff — and shows no verdict for any of them.
 * Every result is read from the service when its case is opened.
 */
export function LocalCases() {
  return (
    <div className="space-y-7">
      <PageHead
        kicker={<LocalModeStamp inline />}
        title="Five reviewed synthetic cases, read from the local service."
        lede={
          <>
            Each case opens a real HTTP read of the accepted Python service at <span className="mono-id">{LOCAL_SERVICE_TARGET.replace("http://", "")}</span>, through
            this app’s same-origin proxy. Verdicts are the pinned evaluator’s, copied unchanged. Nothing on the demo pages — Overview, Verifications, Connections,
            Rules, Settings — comes from this service.
          </>
        }
      />
      <Panel
        title="Known case IDs"
        description="From the reviewed Phase 2 handoff. No collection endpoint exists, so no result is shown until a case is opened."
      >
        <ul className="divide-y divide-line-subtle">
          {KNOWN_LOCAL_CASES.map((c) => (
            <li key={c.id}>
              <a
                href={href(`/local/verifications/${c.id}`)}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3.5 transition-colors duration-(--fa-dur-fast) hover:bg-hover sm:px-5"
              >
                <span className="min-w-0">
                  <span className="mono-id block font-medium text-ink">{c.id}</span>
                  <span className="mono-id block truncate text-[10.5px] text-ink-3">fixture {c.fixture} · result read on open</span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 group-hover:text-ink">
                  Open case <ArrowRight size={12} aria-hidden />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Panel>
      <p className="max-w-[720px] text-xs leading-[1.55] text-ink-3">
        If the local service is not running, a case shows <b className="font-semibold text-ink-2">Service unavailable</b> — never demo data in its place. Start it
        with <span className="mono-id">scripts/phase2/local-service.sh</span>.
      </p>
    </div>
  );
}
