"use strict";
/*
 * The app's side of the engine page. It only carries things between Swift and the two scripts the page loads: the
 * packaged checker (flowassert-check.js, the global FlowAssert), which runs every check, and the app's readers
 * (flowassert-app.js, the global FlowAssertApp: the browser's file profile, worksheet listing, saved-report reader,
 * explorer and character diff). It reads the inputs' bytes from flowassert://engine/input/TOKEN and returns what the
 * scripts return. It decides nothing and changes no byte of what they return.
 */
(() => {
  const ORIGIN = "iPhone and iPad app";
  const ENCODINGS = ["utf-8", "utf-16", "gb18030"];

  async function bytes(token) {
    const response = await fetch("flowassert://engine/input/" + encodeURIComponent(token));
    if (!response.ok) throw new Error("an input could not be read from the app");
    return new Uint8Array(await response.arrayBuffer());
  }

  async function file(side) {
    const out = { name: side.name, content: await bytes(side.token) };
    if (side.encoding !== undefined) out.encoding = side.encoding;
    if (side.format !== undefined) out.format = side.format;
    if (side.worksheet !== undefined) out.worksheet = side.worksheet;
    return out;
  }

  // The configuration chosen in the app, as the CSV check page writes it: key, fields, scope, in that order.
  const chosen = (c) => ({ key: [c.key[0], c.key[1]], fields: c.fields.map((f) => ({ source: f[0], destination: f[1], rule: f[2] })), scope: c.scope });

  const optional = (request, names) => {
    const out = {};
    for (const name of names) if (request[name] !== undefined && request[name] !== null) out[name] = request[name];
    return out;
  };

  const appFile = async (side) => {
    const f = await file(side);
    return { name: f.name, bytes: f.content, encoding: f.encoding, format: f.format, worksheet: f.worksheet };
  };

  window.host = {
    status() {
      return { version: FlowAssert.VERSION, hostProblem: FlowAssert.hostProblem(ENCODINGS) };
    },

    /** One check, and its JSON report opened with the saved-report reader, so the result is read from the report. */
    async check(request) {
      const input = {
        source: await file(request.source),
        destination: await file(request.destination),
        config: request.config.token !== undefined ? await bytes(request.config.token) : chosen(request.config.chosen),
        sourceComplete: request.sourceComplete,
        destinationComplete: request.destinationComplete,
        sourceCount: request.sourceCount,
        destinationCount: request.destinationCount,
        allowIdenticalContent: request.allowIdenticalContent,
        origin: ORIGIN,
        ...optional(request, ["exports", "details", "redactValues", "maxBytes", "maxRows"]),
      };
      const started = performance.now();
      const result = await FlowAssert.checkCsv(input);
      const milliseconds = performance.now() - started;
      const report = request.open && result.json !== null ? FlowAssertApp.open(new TextEncoder().encode(result.json), "report.json") : null;
      return { ...result, milliseconds, report };
    },

    profile: async (side) => FlowAssertApp.profile(await appFile(side)),
    sheets: async (side) => FlowAssertApp.sheets(await appFile(side)),
    configuration: (key, fields, scope) => FlowAssertApp.configuration(key, fields, scope),
    open: async (token, name) => FlowAssertApp.open(await bytes(token), name),
    query: (id, q) => FlowAssertApp.query(id, q),
    window: (id, start, count) => FlowAssertApp.window(id, start, count),
    release: (id) => FlowAssertApp.release(id),
    diff: (a, b) => FlowAssertApp.diff(a, b),
  };
})();
