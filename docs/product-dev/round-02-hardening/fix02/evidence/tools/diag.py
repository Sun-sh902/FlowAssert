import sys, re
p = sys.argv[1]
s = open(p, encoding="utf8").read()
# 1. import test for test.info() and appendFileSync
s = s.replace('import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";', 'import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";\nimport { test as __t } from "@playwright/test";', 1)
s = s.replace('import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";', 'import { appendFileSync, chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";\nimport { test as __t } from "@playwright/test";', 1)
diag = '''
const __T0 = Date.now();
function __title() { try { return __t.info().title + " #" + __t.info().repeatEachIndex + " [" + __t.info().project.name + "]"; } catch { return "<no test>"; } }
function __log(o: Record<string, unknown>) { if (process.env.FA_DIAG_LOG) appendFileSync(process.env.FA_DIAG_LOG, JSON.stringify({ t: Date.now() - __T0, test: __title(), ...o }) + "\\n"); }
'''
s = s.replace("export function captureNetwork(page: Page) {", diag + "export function captureNetwork(page: Page) {\n  const __owner = __title(); let __settles = 0;\n  page.on(\"close\", () => __log({ ev: \"page-close\", owner: __owner }));", 1)
s = s.replace("    pending.push(\n      (async () => {\n        let body: string | null = null;", "    const __n = pending.length; __log({ ev: \"response\", owner: __owner, n: __n, url: res.url(), status: res.status(), afterSettles: __settles });\n    pending.push(\n      (async () => {\n        let body: string | null = null;", 1)
s = s.replace("        } catch {\n          body = null;\n        }\n        const h = await res.allHeaders();", "        } catch (e) {\n          body = null; __log({ ev: \"body-failed\", owner: __owner, n: __n, err: String(e).slice(0, 120) });\n        }\n        let h: Record<string, string>;\n        try { h = await res.allHeaders(); __log({ ev: \"headers-ok\", owner: __owner, n: __n }); } catch (e) { __log({ ev: \"HEADERS-FAILED\", owner: __owner, n: __n, url: res.url(), err: String(e).slice(0, 120) }); throw e; }", 1)
s = s.replace("settle: () => Promise.all(pending)", "settle: () => { __settles++; __log({ ev: \"settle\", owner: __owner, snapshot: pending.length }); return Promise.all(pending); }", 1)
assert s.count("__log(") >= 6, p
open(p, "w", encoding="utf8").write(s)
