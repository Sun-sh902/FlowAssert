// FIX04 supplemental real-Service visual matrix. Run from ui after build/bootstrap --harness (or --product-harness).
// Usage: node scripts/dev/fix04-product-review.mjs ABSOLUTE_NEW_OUTPUT_DIR [before]
// Owns only the processes it starts; never changes fixtures or accepted evidence.
// Residual closeout R13: a release gate in scripts/dev/regression.sh (gate responsive-matrix, checked by
// scripts/dev/check_test_inventory.py matrix). The output directory may be any new absolute path; inside this
// repository it must be git-ignored. It measures only the build in dist/: the preview it starts must serve that
// dist/index.html, whose digest is recorded with the commit.
import { chromium, webkit } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
const ui = process.cwd(), root = resolve(ui, '..'), out = process.argv[2];
if (!out || !isAbsolute(out) || existsSync(out)) throw Error('Provide a new absolute output directory');
if (out.startsWith(root + '/')) {
  try { execFileSync('git', ['-C', root, 'check-ignore', '-q', out + '/']); } catch { throw Error(`Refusing ${out}: inside the repository it must be git-ignored`); }
}
const distIndex = readFileSync(join(ui, 'dist/index.html'));
for (const port of [5183, 8765]) {
  let listener = '';
  try { listener = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }); } catch { /* no listener */ }
  if (listener) throw Error(`Port ${port} occupied: ${listener}`);
}
mkdirSync(out, { recursive: true });
const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n');
save('identity.json', { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), status: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }), distIndexSha256: createHash('sha256').update(distIndex).digest('hex'), command: process.argv, started: new Date().toISOString() });
const processes = [], rows = [];
function start(name, command, args, env = {}) {
  const p = spawn(command, args, { cwd: ui, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = []; p.stdout.on('data', d => log.push(String(d))); p.stderr.on('data', d => log.push(String(d)));
  processes.push({ name, p, log }); return p;
}
async function stop(p) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  const done = new Promise(r => p.once('exit', r)); p.kill('SIGINT'); await done;
}
async function ready(url, p) {
  for (let n = 0; n < 300; n++) {
    if (p.exitCode !== null) throw Error('Child exited before ready');
    try { await fetch(url); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw Error(`Not ready: ${url}`);
}
const seed = JSON.parse(readFileSync(join(ui, 'docs/phase3a/evidence/seed/states.json'), 'utf8'));
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
let svc, browser;
try {
  const preview = start('preview', process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '5183', '--strictPort']);
  await ready('http://127.0.0.1:5183', preview);
  if (!Buffer.from(await (await fetch('http://127.0.0.1:5183/')).arrayBuffer()).equals(distIndex)) throw Error("Port 5183 does not serve this build's dist/index.html");
  for (const state of ['dev-main', 'down', 'ui-corrupt', 'ui-unverifiable']) {
    await stop(svc); svc = null;
    if (state !== 'down') {
      svc = state === 'dev-main' ? start(state, join(root, 'scripts/dev/service.sh'), [], { FA_STATE: state }) : start(state, join(ui, 'scripts/phase3a/history-service.sh'), [], { FA_HISTORY_STATE: state });
      await ready('http://127.0.0.1:8765/api/v1/history?limit=1', svc);
    }
    const historyId = state === 'dev-main' ? (await (await fetch('http://127.0.0.1:8765/api/v1/history?limit=1')).json()).items[0].history_id : null;
    const routes = state === 'dev-main' ? [
      ['overview', '#/', '[data-case] [data-comparison="SAME_INPUT_AGREE"]'],
      ['verifications', '#/verifications', '[data-case-table] [data-comparison="SAME_INPUT_AGREE"]'],
      ['detail', '#/local/verifications/SPEC-005', '[data-result-relation]'],
      ['history', '#/local/history', 'a[data-history-link]'],
      ['archived-detail', `#/local/history/${historyId}`, '[data-retrieval]'],
      ['rules', '#/rules', 'main h1'], ['states', '#/states', '#st-live'],
    ] : state === 'down' ? [['unavailable', '#/', '[data-service-status="UNAVAILABLE"]']] : [[state, `#/local/history/${seed[state].damage.history_id}`, `[data-integrity-notice="${state === 'ui-corrupt' ? 'failed' : 'unverifiable'}"]`]];
    for (const engine of process.argv[3] === 'before' ? ['chrome'] : ['chrome', 'webkit']) {
      browser = await (engine === 'chrome' ? chromium.launch({ channel: 'chrome' }) : webkit.launch());
      for (const theme of ['light', 'dark']) for (const width of [375, 768, 1024, 1280, 1440]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.addInitScript(t => { try { localStorage.setItem('flowassert.theme', t); } catch { /* about:blank has no storage */ } }, theme);
        const page = await context.newPage();
        for (const [name, hash, selector] of routes) {
          const errors = [], requests = []; const onError = e => errors.push(e.message); const onRequest = r => requests.push(r.url());
          page.on('pageerror', onError); page.on('request', onRequest);
          const key = `${engine}-${theme}-${width}-${name}`;
          const row = { key, engine, browser: browser.version(), theme, width, name, state, hash };
          try {
            await page.goto('about:blank'); await page.goto(`http://127.0.0.1:5183/${hash}`);
            await page.locator(selector).first().waitFor({ state: 'attached', timeout: 20000 });
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)));
            if (name === 'history') await page.locator('tr[data-history-id]').first().waitFor({ state: 'attached' });
            if (name === 'archived-detail') {
              await page.getByRole('button', { name: 'Read all remaining', exact: true }).click();
              await page.locator('[data-integrity="verified"]').waitFor();
            }
            row.layout = await page.evaluate(() => {
              const visible = e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden';
              const chips = [...document.querySelectorAll('[data-comparison-strip] [data-comparison]')].filter(visible);
              const overlaps = chips.flatMap((a, i) => chips.slice(i + 1).filter(b => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1; }).map(b => [a.textContent, b.textContent]));
              const clipped = [...document.querySelectorAll('[data-comparison], .fa-seal, .fa-itag')].filter(visible).filter(e => e.scrollWidth > e.clientWidth + 2 && ['hidden', 'clip'].includes(getComputedStyle(e).overflowX)).map(e => e.textContent);
              const type = [...document.querySelectorAll('main p, main td, main th, main .kicker, nav a, main .fa-seal')].filter(visible).slice(0, 90).map(e => { const s = getComputedStyle(e); return { text: e.textContent.slice(0, 90), font: s.fontFamily, size: s.fontSize, line: s.lineHeight, color: s.color }; });
              // A short monospaced identifier (status word, ID, version) broken between two ordinary characters
              // (overflow-wrap) no longer reads as one token. Breaks at a hyphen, slash or truncation ellipsis are
              // normal wrapping: recorded, not failed.
              const split = [], wrapped = [];
              const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
              for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const el = n.parentElement;
                if (!el || el.closest('.sr-only, [aria-hidden="true"]') || !visible(el) || !/mono/i.test(getComputedStyle(el).fontFamily)) continue;
                for (const m of n.textContent.matchAll(/\S{4,32}/g)) {
                  const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
                  if (new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size < 2) continue;
                  const top = i => { const c = document.createRange(); c.setStart(n, m.index + i); c.setEnd(n, m.index + i + 1); return Math.round(c.getBoundingClientRect().top); };
                  let i = 1; while (i < m[0].length && top(i) === top(0)) i++;
                  (/[-/…]/.test(m[0][i - 1]) ? wrapped : split).push(`${m[0].slice(0, i)}|${m[0].slice(i)}`);
                }
              }
              return { scrollWidth: document.documentElement.scrollWidth, split: [...new Set(split)], wrapped: [...new Set(wrapped)], h1: [...document.querySelectorAll('main h1')].filter(visible).map(e => e.textContent), overlaps, clipped, type };
            });
            await page.addScriptTag({ path: axePath });
            row.axe = await page.evaluate(async () => (await window.axe.run({ exclude: [['[data-ornament]']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })));
            await page.screenshot({ path: join(out, key + '.jpg'), type: 'jpeg', quality: 70, fullPage: true });
            // An unclipped page can still conceal the right edge of a table from keyboard users.
            // Every scroll container that hides visible text must itself be focusable (WebKit does not
            // scroll one from a focused link inside it). Visually hidden (sr-only) text does not count.
            row.scrollers = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1).map(e => {
              const right = e.getBoundingClientRect().right;
              const hidden = [...e.querySelectorAll('*')].filter(c => !c.closest('.sr-only')).flatMap(c => [...c.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim())).filter(n => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().right > right + 1; }).map(n => n.textContent.trim().slice(0, 40));
              return { overflow: e.scrollWidth - e.clientWidth, tabIndex: e.tabIndex, label: e.getAttribute('aria-label'), hidden: [...new Set(hidden)] };
            }));
            const tableRegion = page.getByRole('region', { name: 'Archived evaluations table' });
            if (name === 'history' && (width === 768 || width === 1024)) {
              await tableRegion.focus();
              if (!await tableRegion.evaluate(e => document.activeElement === e && e.tabIndex === 0)) throw Error('History table is not keyboard focusable');
              for (let n = 0; n < 20; n++) await page.keyboard.press('ArrowRight');
              await page.waitForFunction(() => { const e = document.querySelector('[data-history-layout="wide"]'); return e.scrollWidth - e.clientWidth - e.scrollLeft <= 1; });
              row.tableScroll = await tableRegion.evaluate(e => ({ scrollLeft: e.scrollLeft, maxScroll: e.scrollWidth - e.clientWidth, focusVisible: e.matches(':focus-visible') }));
              await page.screenshot({ path: join(out, key + '-scrolled.jpg'), type: 'jpeg', quality: 70 });
            } else if (name === 'history' && await tableRegion.count()) throw Error('History table adds a Tab stop although it fits');
            row.focus = [];
            if (name === 'overview') for (let n = 0; n < 12; n++) {
              await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab');
              row.focus.push(await page.evaluate(() => { const e = document.activeElement, s = getComputedStyle(e); return { name: e.getAttribute('aria-label') || e.textContent.slice(0, 60), tag: e.tagName, visible: e.matches(':focus-visible'), ring: s.boxShadow, outline: s.outlineStyle }; }));
            }
            row.problems = [ ...(row.layout.scrollWidth > width ? ['horizontal overflow'] : []), ...(row.layout.h1.length !== 1 ? ['not one visible H1'] : []), ...(row.layout.overlaps.length ? ['comparison chip overlap'] : []), ...(row.layout.clipped.length ? ['clipped status text'] : []), ...row.layout.split.map(t => `split identifier: ${t}`),...row.scrollers.filter(s => s.hidden.length && s.tabIndex < 0).map(s => `keyboard-unreachable: ${s.hidden.join(' | ')}`),...row.axe.map(v => `axe:${v.id}`), ...errors, ...requests.filter(u => !u.startsWith('http://127.0.0.1:5183/') && !u.startsWith('about:')).map(u => `external:${u}`), ...row.focus.filter(f => !f.visible || f.outline === 'none' && f.ring === 'none').map(f => `focus:${f.name}`) ];
          } catch (e) { row.problems = [String(e)]; }
          row.errors = errors; row.requests = requests; rows.push(row); save('results.json', rows);
          page.off('pageerror', onError); page.off('request', onRequest);
          console.log(key, row.problems.length ? JSON.stringify(row.problems) : 'PASS');
        }
        await context.close();
      }
      await browser.close(); browser = null;
    }
  }
} finally {
  if (browser) await browser.close();
  for (const { p } of processes.toReversed()) await stop(p);
  save('processes.json', processes.map(({ name, p }) => ({ name, pid: p.pid, exit: p.exitCode, signal: p.signalCode })));
  for (const { name, log } of processes) writeFileSync(join(out, name + '.log'), log.join(''));
}
const expected = process.argv[3] === 'before' ? 100 : 200;
save('summary.json', { expected, executed: rows.length, passed: rows.filter(r => !r.problems.length).length, failed: rows.filter(r => r.problems.length).map(r => ({ key: r.key, problems: r.problems })) });
if (rows.length !== expected || rows.some(r => r.problems.length)) process.exitCode = 1;
