/**
 * What the browser check says about where saved reports are: the shared origin of the GitHub Pages demo, and a
 * refusal to store, with the browser's own words kept untranslated.
 */
import { PAGES_BUILD } from "../../lib/build";
import { StorageUnavailable } from "../../lib/savedReports";
import { Value } from "./ReportParts";

/** The origin every GitHub Pages site of the owner's account shares. */
export const PAGES_ORIGIN = "sun-sh902.github.io";

/** On the Pages build: anything kept here is readable by every Pages site of the same account. */
export function PagesOriginNotice({ className }: { className?: string }) {
  if (!PAGES_BUILD) return null;
  return (
    <p className={className} data-testid="pages-origin-notice">
      {`On this online demo, saved reports are kept for the site ${PAGES_ORIGIN}, which every GitHub Pages site of that account shares: another of those sites could read them.`}
    </p>
  );
}

/** Why something was not stored, or could not be read from storage. */
export function StorageProblem({ error }: { error: unknown }) {
  if (error instanceof StorageUnavailable) {
    return (
      <>
        <span>{error.reason}</span>
        {error.detail && (
          <>
            {" "}
            <Value className="text-inherit">{`(${error.detail})`}</Value>
          </>
        )}
      </>
    );
  }
  return <Value className="text-inherit">{error instanceof Error ? error.message : String(error)}</Value>;
}
