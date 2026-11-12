/**
 * The Web Worker of the CSV check page. It reads the chosen files as streams, runs the check and builds both reports,
 * so the page stays responsive with files of a million rows and never holds a file whole. The page starts two of
 * them: one for checks, one for headers and profiles. It answers only the page's messages and makes no request.
 */
import { Abandoned } from "./profile";
import { Explorer } from "./explore";
import { accessOf, answer, factsOf, header, keyProfile, profile, resendOf, runCheckKeeping, sheets, type ExportFileResult, type Reply, type Request } from "./runner";

const post = (reply: Reply) => (self as unknown as Worker).postMessage(reply);
/** Profile reads the page has given up: each ends at its next look, and answers "abandoned". */
const abandoned = new Set<number>();
/** The records of the last check's report, for the result explorer: released when the next check starts. */
let explorer: Explorer | null = null;
/** The records to resend of the last check, built when the page first asks for a file: released with the explorer. */
let resend: ((file: string) => Promise<ExportFileResult>) | null = null;
/**
 * Profiles are read one at a time, in the order asked: a read waits for the one before it to end. A read given up
 * while it waits is never started.
 */
let queue: Promise<unknown> = Promise.resolve();
const inTurn = <T>(read: () => Promise<T>): Promise<T> => {
  const turn = queue.then(read);
  queue = turn.catch(() => undefined);
  return turn;
};

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  const id = request.id;
  if (request.type === "abandon") return void abandoned.add(id);
  const given = () => abandoned.has(id);
  try {
    if (request.type === "header") post({ id, type: "header", result: await header(request.file, request.encoding, request.book) });
    else if (request.type === "sheets") post({ id, type: "sheets", result: await sheets(request.file) });
    else if (request.type === "profile") post({ id, type: "profile", result: await inTurn(() => (given() ? Promise.reject(new Abandoned()) : profile(request.file, request.encoding, (rows) => post({ id, type: "rows", rows }), given, request.book))) });
    else if (request.type === "key-profile") post({ id, type: "key-profile", result: await inTurn(() => (given() ? Promise.reject(new Abandoned()) : keyProfile(request.file, request.encoding, request.column, given, request.book))) });
    else if (request.type === "explore") post({ id, type: "explored", result: answer(explorer, request) });
    else if (request.type === "export") post({ id, type: "exported", result: resend ? await resend(request.file) : { ok: false, message: "There is no result to export: run the check again." } });
    else {
      explorer = null;
      resend = null;
      const [result, report] = await runCheckKeeping(request.input, (progress) => post({ id, type: "progress", progress }));
      explorer = report ? new Explorer(accessOf(report), factsOf(report)) : null;
      resend = report ? resendOf(request.input, report) : null;
      post({ id, type: "result", result });
    }
  } catch (e) {
    if (e instanceof Abandoned) post({ id, type: "abandoned" });
    else post({ id, type: "error", message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  } finally {
    abandoned.delete(id);
  }
};
