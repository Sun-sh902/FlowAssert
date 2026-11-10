/**
 * The Web Worker of the CSV check page. It reads the chosen files as streams, runs the check and builds both reports,
 * so the page stays responsive with files of a million rows and never holds a file whole. It answers only the page's messages and makes no request.
 */
import { header, runCheck, type Reply, type Request } from "./runner";

const post = (reply: Reply) => (self as unknown as Worker).postMessage(reply);

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === "header") post({ id: request.id, type: "header", result: await header(request.file, request.encoding) });
    else post({ id: request.id, type: "result", result: await runCheck(request.input, (progress) => post({ id: request.id, type: "progress", progress })) });
  } catch (e) {
    post({ id: request.id, type: "error", message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  }
};
