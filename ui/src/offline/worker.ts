/**
 * The Web Worker of the CSV check page. It reads the chosen files as streams, runs the check and builds both reports,
 * so the page stays responsive with files of a million rows and never holds a file whole. The page starts two of
 * them: one for checks, one for headers and profiles. It answers only the page's messages and makes no request.
 */
import { Abandoned } from "./profile";
import { header, keyProfile, profile, runCheck, type Reply, type Request } from "./runner";

const post = (reply: Reply) => (self as unknown as Worker).postMessage(reply);
/** Profile reads the page has given up: each ends at its next look, and answers "abandoned". */
const abandoned = new Set<number>();
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
    if (request.type === "header") post({ id, type: "header", result: await header(request.file, request.encoding) });
    else if (request.type === "profile") post({ id, type: "profile", result: await inTurn(() => (given() ? Promise.reject(new Abandoned()) : profile(request.file, request.encoding, (rows) => post({ id, type: "rows", rows }), given))) });
    else if (request.type === "key-profile") post({ id, type: "key-profile", result: await inTurn(() => (given() ? Promise.reject(new Abandoned()) : keyProfile(request.file, request.encoding, request.column, given))) });
    else post({ id, type: "result", result: await runCheck(request.input, (progress) => post({ id, type: "progress", progress })) });
  } catch (e) {
    if (e instanceof Abandoned) post({ id, type: "abandoned" });
    else post({ id, type: "error", message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  } finally {
    abandoned.delete(id);
  }
};
