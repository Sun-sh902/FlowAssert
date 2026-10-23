import { chromium, webkit, firefox } from "@playwright/test";
const out = {};
for (const [name, bt, opts] of [["chrome", chromium, { channel: "chrome" }], ["chromium-bundled", chromium, {}], ["webkit", webkit, {}], ["firefox", firefox, {}]]) {
  const t0 = Date.now();
  try {
    const b = await bt.launch({ ...opts, timeout: 30000 });
    const p = await b.newPage();
    await p.setContent("<p>x</p>");
    out[name] = { ok: true, version: b.version(), ua: await p.evaluate(() => navigator.userAgent), executable: bt.executablePath?.() , ms: Date.now() - t0 };
    await b.close();
  } catch (e) { out[name] = { ok: false, error: String(e.message).split("\n").slice(0, 3).join(" | "), ms: Date.now() - t0 }; }
}
console.log(JSON.stringify(out, null, 1));
